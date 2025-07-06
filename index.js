const express = require("express");
const cors = require("cors");
const multer = require("multer");
const crypto = require("crypto");
const os = require("os");
const { performance } = require("perf_hooks");
const app = express();

// Process error handling
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// CORS configuration - Allow all origins for development
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "https://splendid-brioche-ee2e1c.netlify.app",
      "https://zemoz.fun",'speedtestoffical.netlify.app',
    ], // Or '*' to allow all origins (for dev only)
    methods: ["GET", "POST"],
    credentials: true,
  })
);

// Middleware for parsing JSON and raw data
app.use(express.json({ limit: "500mb" }));
app.use(express.raw({ limit: "500mb", type: "application/octet-stream" }));

// Configure multer for file uploads
const upload = multer({
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB
  },
  storage: multer.memoryStorage(),
});

// Server configuration
const PORT = process.env.PORT || 3001;
const SERVER_INFO = {
  name: "Speed Test Server",
  location: "Local",
  host: os.hostname(),
  platform: os.platform(),
  arch: os.arch(),
  cores: os.cpus().length,
  memory: Math.round(os.totalmem() / 1024 / 1024 / 1024) + "GB",
};

// Test data cache for performance
const testDataCache = new Map();

// Generate test data with caching
const generateTestData = (sizeInMB, pattern = "random") => {
  const key = `${sizeInMB}mb_${pattern}`;

  if (!testDataCache.has(key)) {
    const sizeInBytes = sizeInMB * 1024 * 1024;
    let buffer;

    switch (pattern) {
      case "random":
        buffer = crypto.randomBytes(sizeInBytes);
        break;
      case "compressible":
        buffer = Buffer.alloc(sizeInBytes, 0x41);
        break;
      case "incompressible":
        buffer = Buffer.alloc(sizeInBytes);
        for (let i = 0; i < sizeInBytes; i++) {
          buffer[i] = (i * 137 + 19) % 256;
        }
        break;
      default:
        buffer = crypto.randomBytes(sizeInBytes);
    }

    testDataCache.set(key, buffer);
  }

  return testDataCache.get(key);
};

// Pre-generate common test data sizes
const commonSizes = [0.1, 0.5, 1, 2, 5, 10, 25, 50];
commonSizes.forEach((size) => {
  generateTestData(size, "random");
  generateTestData(size, "compressible");
});

// High-resolution timestamp
const getHighResolutionTime = () => {
  return performance.now() + performance.timeOrigin;
};

// Basic ping endpoint
app.get("/api/ping", (req, res) => {
  const serverTime = getHighResolutionTime();
  const clientTime = parseFloat(req.query.t) || serverTime;
  const sequence = parseInt(req.query.seq) || 0;

  res.json({
    clientTime,
    serverTime,
    sequence,
    server: SERVER_INFO.name,
  });
});

// Server info endpoint
app.get("/api/info", (req, res) => {
  res.json({
    server: SERVER_INFO,
    timestamp: getHighResolutionTime(),
    uptime: process.uptime(),
    memory: {
      used: process.memoryUsage().rss,
      total: os.totalmem(),
      free: os.freemem(),
    },
  });
});

// Enhanced latency test endpoint
app.get("/api/latency-advanced", (req, res) => {
  const count = Math.min(parseInt(req.query.count) || 5, 10);
  const interval = Math.max(parseInt(req.query.interval) || 50, 100);

  const measurements = [];
  let completed = 0;
  const startTime = getHighResolutionTime();

  const performMeasurement = (index) => {
    const measurementTime = getHighResolutionTime();

    measurements.push({
      index,
      clientStartTime: startTime,
      serverTime: measurementTime,
      latency: measurementTime - startTime,
    });

    completed++;

    if (completed >= count) {
      // Calculate statistics
      const latencies = measurements.map((m) => m.latency);
      const average = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const min = Math.min(...latencies);
      const max = Math.max(...latencies);
      const jitter = max - min;

      res.json({
        measurements,
        statistics: {
          count: completed,
          average: average.toFixed(3),
          minimum: min.toFixed(3),
          maximum: max.toFixed(3),
          jitter: jitter.toFixed(3),
        },
        server: SERVER_INFO.name,
      });
    } else {
      setTimeout(() => performMeasurement(index + 1), interval);
    }
  };

  performMeasurement(0);
});

// FIXED Warmup endpoint
app.get("/api/warmup-advanced", (req, res) => {
  const startTime = getHighResolutionTime();

  // Set headers
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("X-Warmup-Start", startTime.toString());

  // Send warmup data in phases
  const phases = [
    { size: 0.1, delay: 100 },
    { size: 0.5, delay: 150 },
    { size: 1.0, delay: 200 },
    { size: 2.0, delay: 250 },
  ];

  let currentPhase = 0;
  let isFinished = false;

  const cleanup = () => {
    isFinished = true;
  };

  const sendPhase = () => {
    if (isFinished || res.destroyed) return;

    if (currentPhase >= phases.length) {
      res.end();
      cleanup();
      return;
    }

    const phase = phases[currentPhase];

    try {
      const phaseData = generateTestData(phase.size, "random");

      if (!res.destroyed && !isFinished) {
        const success = res.write(phaseData);
        currentPhase++;

        if (currentPhase < phases.length) {
          if (success) {
            setTimeout(sendPhase, phase.delay);
          } else {
            res.once("drain", () => setTimeout(sendPhase, phase.delay));
          }
        } else {
          // This is the last phase
          setTimeout(() => {
            if (!isFinished && !res.destroyed) {
              res.end();
              cleanup();
            }
          }, phase.delay);
        }
      }
    } catch (error) {
      console.error("Error in warmup phase:", error);
      if (!res.destroyed && !isFinished) {
        res.end();
      }
      cleanup();
    }
  };

  // Handle client disconnect
  req.on("close", cleanup);
  req.on("aborted", cleanup);
  res.on("close", cleanup);
  res.on("error", cleanup);

  // Start sending phases
  sendPhase();
});

// FIXED Download test endpoint
app.get("/api/download/:size", (req, res) => {
  const size = parseFloat(req.params.size);
  const pattern = req.query.pattern || "random";
  const connections = parseInt(req.query.connections) || 1;

  if (isNaN(size) || size < 0.1 || size > 10) {
    return res
      .status(400)
      .json({ error: "Invalid size. Must be between 0.1 and 10 MB" });
  }

  try {
    const testData = generateTestData(size, pattern);
    const startTime = getHighResolutionTime();

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", testData.length.toString());
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("X-Test-Start", startTime.toString());
    res.setHeader("X-Test-Size", size.toString());
    res.setHeader("X-Pattern", pattern);
    res.setHeader("X-Connections", connections.toString());

    // Send data in chunks
    const chunkSize = 64 * 1024; // 64KB chunks
    let offset = 0;
    let isFinished = false;

    const cleanup = () => {
      isFinished = true;
    };

    const sendChunk = () => {
      if (isFinished || res.destroyed) return;

      if (offset >= testData.length) {
        res.end();
        cleanup();
        return;
      }

      const chunk = testData.slice(
        offset,
        Math.min(offset + chunkSize, testData.length)
      );

      try {
        const writeSuccess = res.write(chunk);
        offset += chunk.length;

        if (writeSuccess) {
          setImmediate(sendChunk);
        } else {
          res.once("drain", sendChunk);
        }
      } catch (error) {
        console.error("Error writing chunk:", error);
        cleanup();
      }
    };

    // Handle client disconnect
    req.on("close", cleanup);
    req.on("aborted", cleanup);
    res.on("close", cleanup);
    res.on("error", cleanup);

    sendChunk();
  } catch (error) {
    console.error("Download test error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate test data" });
    }
  }
});

// COMPLETELY FIXED Adaptive download endpoint
// app.get("/api/download-adaptive", (req, res) => {
//   const initialSize = Math.max(parseFloat(req.query.initial) || 1, 0.1);
//   const maxSize = Math.min(parseFloat(req.query.max) || 5, 10);
//   const duration = Math.min(parseInt(req.query.duration) || 5, 10);
//   const pattern = req.query.pattern || "random";

//   const startTime = getHighResolutionTime();
//   let currentSize = initialSize;
//   let isFinished = false;

//   // Set response headers
//   res.setHeader("Content-Type", "application/octet-stream");
//   res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
//   res.setHeader("Pragma", "no-cache");
//   res.setHeader("Expires", "0");
//   res.setHeader("X-Test-Type", "adaptive");
//   res.setHeader("X-Start-Time", startTime.toString());
//   res.setHeader("X-Pattern", pattern);
//   res.setHeader("X-Initial-Size", initialSize.toString());
//   res.setHeader("X-Max-Size", maxSize.toString());
//   res.setHeader("X-Duration", duration.toString());

//   const cleanup = () => {
//     isFinished = true;
//   };

//   const sendData = () => {
//     if (isFinished || res.destroyed) return;

//     const now = getHighResolutionTime();
//     const elapsed = (now - startTime) / 1000;

//     // Check if duration has been reached
//     if (elapsed >= duration) {
//       if (!res.destroyed && !isFinished) {
//         res.end();
//       }
//       cleanup();
//       return;
//     }

//     // Adaptive sizing - gradually increase size
//     const progress = elapsed / duration;
//     const targetSize =
//       initialSize + (maxSize - initialSize) * Math.min(progress * 2, 1);
//     currentSize = Math.min(targetSize, maxSize);

//     try {
//       // Generate smaller chunks more frequently for better control
//       const chunkSize = Math.max(currentSize * 0.1, 0.1); // 10% of current size or minimum 0.1MB
//       const chunkData = generateTestData(chunkSize, pattern);

//       if (!res.destroyed && !isFinished) {
//         const writeSuccess = res.write(chunkData);

//         // Schedule next chunk
//         const nextDelay = Math.max(50, 200 - elapsed * 10); // Decrease delay over time

//         if (writeSuccess) {
//           setTimeout(sendData, nextDelay);
//         } else {
//           res.once("drain", () => setTimeout(sendData, nextDelay));
//         }
//       }
//     } catch (error) {
//       console.error("Error in adaptive download:", error);
//       if (!res.destroyed && !isFinished) {
//         res.end();
//       }
//       cleanup();
//     }
//   };

//   // Handle client disconnect and errors
//   req.on("close", cleanup);
//   req.on("aborted", cleanup);
//   res.on("close", cleanup);
//   res.on("error", (error) => {
//     console.error("Response error in adaptive download:", error);
//     cleanup();
//   });

//   // Start the adaptive download
//   sendData();
// });
app.get("/api/download-adaptive", (req, res) => {
  const initialSize = Math.max(parseFloat(req.query.initial) || 1, 0.1); // MB
  const maxSize = Math.min(parseFloat(req.query.max) || 5, 10); // MB
  const duration = Math.min(parseInt(req.query.duration) || 5, 10); // seconds
  const pattern = req.query.pattern || "random";
  const throttle = Math.max(parseFloat(req.query.throttle) || 1, 0.1); // 0.1 = 90% slower

  const startTime = getHighResolutionTime();
  let currentSize = initialSize;
  let isFinished = false;

  // Headers
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("X-Test-Type", "adaptive");
  res.setHeader("X-Start-Time", startTime.toString());
  res.setHeader("X-Pattern", pattern);
  res.setHeader("X-Initial-Size", initialSize.toString());
  res.setHeader("X-Max-Size", maxSize.toString());
  res.setHeader("X-Duration", duration.toString());
  res.setHeader("X-Throttle", throttle.toString());

  const cleanup = () => {
    isFinished = true;
  };

  const sendData = () => {
    if (isFinished || res.destroyed) return;

    const now = getHighResolutionTime();
    const elapsed = (now - startTime) / 1000;

    if (elapsed >= duration) {
      if (!res.destroyed && !isFinished) res.end();
      cleanup();
      return;
    }

    // Progress-based sizing
    const progress = elapsed / duration;
    const targetSize =
      initialSize + (maxSize - initialSize) * Math.min(progress * 2, 1);
    currentSize = Math.min(targetSize, maxSize);

    try {
      // Slower: small chunk size and longer delay
      const chunkSize = Math.max(currentSize * 0.03 * throttle, 0.05); // ~50KB+
      const chunkData = generateTestData(chunkSize, pattern);

      if (!res.destroyed && !isFinished) {
        const writeSuccess = res.write(chunkData);

        // Slower: stable or increasing delay
        const nextDelay = Math.min(300, 100 + elapsed * 10 / throttle);

        if (writeSuccess) {
          setTimeout(sendData, nextDelay);
        } else {
          res.once("drain", () => setTimeout(sendData, nextDelay));
        }
      }
    } catch (error) {
      console.error("Error in adaptive download:", error);
      if (!res.destroyed && !isFinished) res.end();
      cleanup();
    }
  };

  req.on("close", cleanup);
  req.on("aborted", cleanup);
  res.on("close", cleanup);
  res.on("error", (error) => {
    console.error("Response error in adaptive download:", error);
    cleanup();
  });

  sendData();
});


// Upload test endpoint
app.post("/api/upload", upload.single("file"), (req, res) => {
  const receiveStartTime = getHighResolutionTime();
  const clientStartTime =
    parseFloat(req.headers["x-upload-start"]) || receiveStartTime;
  const testSize = parseFloat(req.headers["x-test-size"]) || 0;
  const pattern = req.headers["x-pattern"] || "unknown";

  try {
    let dataSize = 0;
    let dataBuffer = null;

    if (req.file) {
      dataSize = req.file.size;
      dataBuffer = req.file.buffer;
    } else if (req.body && Buffer.isBuffer(req.body)) {
      dataSize = req.body.length;
      dataBuffer = req.body;
    } else {
      return res.status(400).json({ error: "No data received" });
    }

    const receiveEndTime = getHighResolutionTime();
    const processingTime = receiveEndTime - receiveStartTime;
    const totalTime = receiveEndTime - clientStartTime;

    // Calculate upload speed
    const speedMbps =
      totalTime > 0 ? (dataSize * 8) / ((totalTime / 1000) * 1024 * 1024) : 0;

    // Generate a simple checksum for data integrity
    const checksum = dataBuffer
      ? crypto
          .createHash("md5")
          .update(dataBuffer)
          .digest("hex")
          .substring(0, 8)
      : "unknown";

    res.json({
      success: true,
      timing: {
        clientStartTime,
        receiveStartTime,
        receiveEndTime,
        processingTime,
        totalTime,
      },
      data: {
        size: dataSize,
        expectedSize: testSize,
        pattern,
        integrity: checksum,
      },
      performance: {
        speedMbps: speedMbps.toFixed(3),
        efficiency:
          testSize > 0
            ? ((dataSize / (testSize * 1024 * 1024)) * 100).toFixed(2)
            : "100.00",
      },
      server: SERVER_INFO.name,
    });
  } catch (error) {
    console.error("Upload test error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Upload test failed",
        details: error.message,
      });
    }
  }
});

// Multi-connection upload endpoint
app.post("/api/upload-multi", upload.single("file"), (req, res) => {
  const receiveTime = getHighResolutionTime();
  const clientStartTime =
    parseFloat(req.headers["x-upload-start"]) || receiveTime;
  const connectionId = req.headers["x-connection-id"] || "0";
  const totalConnections = parseInt(req.headers["x-total-connections"]) || 1;
  const testSize = parseFloat(req.headers["x-test-size"]) || 0;
  const pattern = req.headers["x-pattern"] || "unknown";

  try {
    let dataSize = 0;

    if (req.file) {
      dataSize = req.file.size;
    } else if (req.body && Buffer.isBuffer(req.body)) {
      dataSize = req.body.length;
    } else {
      return res.status(400).json({ error: "No data received" });
    }

    const processTime = getHighResolutionTime();
    const networkDuration = receiveTime - clientStartTime;
    const processingDuration = processTime - receiveTime;
    const totalDuration = processTime - clientStartTime;

    // Calculate speed for this connection
    const speedMbps =
      totalDuration > 0
        ? (dataSize * 8) / ((totalDuration / 1000) * 1024 * 1024)
        : 0;

    res.json({
      success: true,
      connectionId,
      totalConnections,
      timing: {
        clientStartTime,
        receiveTime,
        processTime,
        networkDuration,
        processingDuration,
        totalDuration,
      },
      data: {
        size: dataSize,
        expectedSize: testSize,
        pattern,
        speedMbps: speedMbps.toFixed(3),
      },
      server: SERVER_INFO.name,
    });
  } catch (error) {
    console.error("Multi-upload test error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Multi-upload test failed",
        connectionId,
        details: error.message,
      });
    }
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error("Server error:", error);
  if (!res.headersSent) {
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
      timestamp: getHighResolutionTime(),
    });
  }
});

// 404 handler
app.use((req, res) => {
  if (!res.headersSent) {
    res.status(404).json({
      error: "Endpoint not found",
      path: req.path,
      timestamp: getHighResolutionTime(),
    });
  }
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`\n🚀 Speed Test Server`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`🖥️  Server: ${SERVER_INFO.name}`);
  console.log(`💻 System: ${SERVER_INFO.platform} (${SERVER_INFO.arch})`);
  console.log(`⚡ Cores: ${SERVER_INFO.cores}`);
  console.log(`🧠 Memory: ${SERVER_INFO.memory}`);
  console.log(`\n📋 Available Endpoints:`);
  console.log(`   GET  /api/ping                    - Basic ping test`);
  console.log(`   GET  /api/info                    - Server information`);
  console.log(`   GET  /api/latency-advanced        - Advanced latency test`);
  console.log(`   GET  /api/warmup-advanced         - Connection warmup`);
  console.log(`   GET  /api/download/:size          - Download test`);
  console.log(`   GET  /api/download-adaptive       - Adaptive download test`);
  console.log(`   POST /api/upload                  - Upload test`);
  console.log(`   POST /api/upload-multi            - Multi-connection upload`);
  console.log(`\n✅ Server ready for testing!\n`);
});

// Server optimization
server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;
server.timeout = 300000;

// TCP optimization
server.on("connection", (socket) => {
  socket.setNoDelay(true);
  socket.setKeepAlive(true, 60000);
});

module.exports = app;

// const express = require('express');
// const cors = require('cors');
// const multer = require('multer');
// const crypto = require('crypto');
// const os = require('os');
// const { performance } = require('perf_hooks');
// const app = express();

// // Process error handling
// process.on('uncaughtException', (error) => {
//   console.error('Uncaught Exception:', error);
//   process.exit(1);
// });

// process.on('unhandledRejection', (reason, promise) => {
//   console.error('Unhandled Rejection at:', promise, 'reason:', reason);
//   process.exit(1);
// });

// // CORS configuration - Allow all origins for development
// app.use(cors({
//   origin: '*',
//   methods: ['GET', 'POST', 'OPTIONS'],
//   allowedHeaders: ['Content-Type', 'Authorization', 'X-Upload-Start', 'X-Connection-Id', 'X-Total-Connections', 'X-Test-Size', 'X-Pattern']
// }));

// // Middleware for parsing JSON and raw data
// app.use(express.json({ limit: '500mb' }));
// app.use(express.raw({ limit: '500mb', type: 'application/octet-stream' }));

// // Configure multer for file uploads
// const upload = multer({
//   limits: {
//     fileSize: 500 * 1024 * 1024, // 500MB
//   },
//   storage: multer.memoryStorage()
// });

// // Server configuration
// const PORT = process.env.PORT || 3001;
// const SERVER_INFO = {
//   name: 'Speed Test Server',
//   location: 'Local',
//   host: os.hostname(),
//   platform: os.platform(),
//   arch: os.arch(),
//   cores: os.cpus().length,
//   memory: Math.round(os.totalmem() / 1024 / 1024 / 1024) + 'GB'
// };

// // Test data cache for performance
// const testDataCache = new Map();

// // Generate test data with caching
// const generateTestData = (sizeInMB, pattern = 'random') => {
//   const key = `${sizeInMB}mb_${pattern}`;

//   if (!testDataCache.has(key)) {
//     const sizeInBytes = sizeInMB * 1024 * 1024;
//     let buffer;

//     switch (pattern) {
//       case 'random':
//         buffer = crypto.randomBytes(sizeInBytes);
//         break;
//       case 'compressible':
//         buffer = Buffer.alloc(sizeInBytes, 0x41);
//         break;
//       case 'incompressible':
//         buffer = Buffer.alloc(sizeInBytes);
//         for (let i = 0; i < sizeInBytes; i++) {
//           buffer[i] = (i * 137 + 19) % 256;
//         }
//         break;
//       default:
//         buffer = crypto.randomBytes(sizeInBytes);
//     }

//     testDataCache.set(key, buffer);
//   }

//   return testDataCache.get(key);
// };

// // Pre-generate common test data sizes
// const commonSizes = [1, 5, 10, 25, 50];
// commonSizes.forEach(size => {
//   generateTestData(size, 'random');
// });

// // High-resolution timestamp
// const getHighResolutionTime = () => {
//   return performance.now() + performance.timeOrigin;
// };

// // Basic ping endpoint
// app.get('/api/ping', (req, res) => {
//   const serverTime = getHighResolutionTime();
//   const clientTime = parseFloat(req.query.t) || serverTime;
//   const sequence = parseInt(req.query.seq) || 0;

//   res.json({
//     clientTime,
//     serverTime,
//     sequence,
//     server: SERVER_INFO.name
//   });
// });

// // Server info endpoint
// app.get('/api/info', (req, res) => {
//   res.json({
//     server: SERVER_INFO,
//     timestamp: getHighResolutionTime(),
//     uptime: process.uptime(),
//     memory: {
//       used: process.memoryUsage().rss,
//       total: os.totalmem(),
//       free: os.freemem()
//     }
//   });
// });

// // Enhanced latency test endpoint
// app.get('/api/latency-advanced', (req, res) => {
//   const count = Math.min(parseInt(req.query.count) || 10, 50);
//   const interval = Math.max(parseInt(req.query.interval) || 100, 50);

//   const measurements = [];
//   let completed = 0;
//   const startTime = getHighResolutionTime();

//   const performMeasurement = (index) => {
//     const measurementTime = getHighResolutionTime();

//     measurements.push({
//       index,
//       clientStartTime: startTime,
//       serverTime: measurementTime,
//       latency: measurementTime - startTime
//     });

//     completed++;

//     if (completed >= count) {
//       // Calculate statistics
//       const latencies = measurements.map(m => measurementTime - startTime + (index * interval));
//       const average = latencies.reduce((a, b) => a + b, 0) / latencies.length;
//       const min = Math.min(...latencies);
//       const max = Math.max(...latencies);
//       const jitter = max - min;

//       res.json({
//         measurements,
//         statistics: {
//           count: completed,
//           average: average.toFixed(3),
//           minimum: min.toFixed(3),
//           maximum: max.toFixed(3),
//           jitter: jitter.toFixed(3)
//         },
//         server: SERVER_INFO.name
//       });
//     } else {
//       setTimeout(() => performMeasurement(index + 1), interval);
//     }
//   };

//   performMeasurement(0);
// });

// // COMPLETELY REWRITTEN Warmup endpoint
// app.get('/api/warmup-advanced', (req, res) => {
//   const startTime = getHighResolutionTime();

//   // Set all headers at once at the beginning
//   res.setHeader('Content-Type', 'application/octet-stream');
//   res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
//   res.setHeader('Pragma', 'no-cache');
//   res.setHeader('Expires', '0');
//   res.setHeader('X-Warmup-Start', startTime.toString());

//   // Send warmup data in phases
//   const phases = [
//     { size: 0.1, delay: 100 },
//     { size: 0.5, delay: 150 },
//     { size: 1.0, delay: 200 },
//     { size: 2.0, delay: 250 }
//   ];

//   let currentPhase = 0;
//   let isFinished = false;

//   const finishResponse = () => {
//     if (isFinished || res.headersSent) return;
//     isFinished = true;

//     try {
//       // Don't set headers here - they might already be sent
//       res.end();
//     } catch (error) {
//       console.error('Error finishing warmup response:', error);
//     }
//   };

//   const sendPhase = () => {
//     if (isFinished || res.destroyed) return;

//     if (currentPhase >= phases.length) {
//       finishResponse();
//       return;
//     }

//     const phase = phases[currentPhase];

//     try {
//       const phaseData = generateTestData(phase.size, 'random');

//       if (!res.destroyed && !isFinished) {
//         res.write(phaseData);
//         currentPhase++;

//         if (currentPhase < phases.length) {
//           setTimeout(sendPhase, phase.delay);
//         } else {
//           // This is the last phase, finish after delay
//           setTimeout(finishResponse, phase.delay);
//         }
//       }
//     } catch (error) {
//       console.error('Error in warmup phase:', error);
//       finishResponse();
//     }
//   };

//   // Handle client disconnect
//   req.on('close', () => {
//     isFinished = true;
//   });

//   req.on('aborted', () => {
//     isFinished = true;
//   });

//   // Start sending phases
//   sendPhase();
// });

// // Download test endpoint - FIXED
// app.get('/api/download/:size', (req, res) => {
//   const size = parseFloat(req.params.size);
//   const pattern = req.query.pattern || 'random';
//   const connections = parseInt(req.query.connections) || 1;

//   if (isNaN(size) || size < 0.1 || size > 500) {
//     return res.status(400).json({ error: 'Invalid size. Must be between 0.1 and 500 MB' });
//   }

//   try {
//     const testData = generateTestData(size, pattern);
//     const startTime = getHighResolutionTime();

//     res.setHeader('Content-Type', 'application/octet-stream');
//     res.setHeader('Content-Length', testData.length.toString());
//     res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
//     res.setHeader('Pragma', 'no-cache');
//     res.setHeader('Expires', '0');
//     res.setHeader('X-Test-Start', startTime.toString());
//     res.setHeader('X-Test-Size', size.toString());
//     res.setHeader('X-Pattern', pattern);
//     res.setHeader('X-Connections', connections.toString());

//     // Stream the data in chunks for better performance
//     const chunkSize = 64 * 1024; // 64KB chunks
//     let offset = 0;
//     let isFinished = false;

//     const sendChunk = () => {
//       if (isFinished || res.destroyed) return;

//       if (offset >= testData.length) {
//         isFinished = true;
//         res.end();
//         return;
//       }

//       const chunk = testData.slice(offset, Math.min(offset + chunkSize, testData.length));

//       try {
//         const writeSuccess = res.write(chunk);
//         offset += chunk.length;

//         if (writeSuccess) {
//           setImmediate(sendChunk);
//         } else {
//           res.once('drain', sendChunk);
//         }
//       } catch (error) {
//         console.error('Error writing chunk:', error);
//         isFinished = true;
//       }
//     };

//     // Handle client disconnect
//     req.on('close', () => {
//       isFinished = true;
//     });

//     sendChunk();

//   } catch (error) {
//     console.error('Download test error:', error);
//     if (!res.headersSent) {
//       res.status(500).json({ error: 'Failed to generate test data' });
//     }
//   }
// });

// // Adaptive download endpoint - FIXED
// app.get('/api/download-adaptive', (req, res) => {
//   const initialSize = parseFloat(req.query.initial) || 1;
//   const maxSize = parseFloat(req.query.max) || 50;
//   const duration = parseInt(req.query.duration) || 10;
//   const pattern = req.query.pattern || 'random';

//   let currentSize = initialSize;
//   let totalSent = 0;
//   let isFinished = false;
//   const startTime = getHighResolutionTime();

//   res.setHeader('Content-Type', 'application/octet-stream');
//   res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
//   res.setHeader('Pragma', 'no-cache');
//   res.setHeader('Expires', '0');
//   res.setHeader('X-Test-Type', 'adaptive');
//   res.setHeader('X-Start-Time', startTime.toString());
//   res.setHeader('X-Pattern', pattern);

//   const finishResponse = () => {
//     if (isFinished || res.destroyed) return;
//     isFinished = true;

//     try {
//       res.end();
//     } catch (error) {
//       console.error('Error finishing adaptive response:', error);
//     }
//   };

//   const sendChunk = () => {
//     if (isFinished || res.destroyed) return;

//     const now = getHighResolutionTime();
//     const elapsed = (now - startTime) / 1000;

//     if (elapsed >= duration) {
//       finishResponse();
//       return;
//     }

//     // Adaptive sizing based on time elapsed
//     if (elapsed > 2 && currentSize < maxSize) {
//       currentSize = Math.min(currentSize * 1.2, maxSize);
//     }

//     try {
//       const chunkData = generateTestData(currentSize, pattern);
//       res.write(chunkData);
//       totalSent += chunkData.length;

//       // Continue sending with small delay
//       setImmediate(sendChunk);
//     } catch (error) {
//       console.error('Error in adaptive chunk:', error);
//       finishResponse();
//     }
//   };

//   // Handle client disconnect
//   req.on('close', () => {
//     isFinished = true;
//     console.log('Client disconnected from adaptive download');
//   });

//   sendChunk();
// });

// // Upload test endpoint
// app.post('/api/upload', upload.single('file'), (req, res) => {
//   const receiveStartTime = getHighResolutionTime();
//   const clientStartTime = parseFloat(req.headers['x-upload-start']) || receiveStartTime;
//   const testSize = parseFloat(req.headers['x-test-size']) || 0;
//   const pattern = req.headers['x-pattern'] || 'unknown';

//   try {
//     let dataSize = 0;
//     let dataBuffer = null;

//     if (req.file) {
//       dataSize = req.file.size;
//       dataBuffer = req.file.buffer;
//     } else if (req.body && Buffer.isBuffer(req.body)) {
//       dataSize = req.body.length;
//       dataBuffer = req.body;
//     } else {
//       return res.status(400).json({ error: 'No data received' });
//     }

//     const receiveEndTime = getHighResolutionTime();
//     const processingTime = receiveEndTime - receiveStartTime;
//     const totalTime = receiveEndTime - clientStartTime;

//     // Calculate upload speed
//     const speedMbps = totalTime > 0 ? (dataSize * 8) / (totalTime / 1000 * 1024 * 1024) : 0;

//     // Generate a simple checksum for data integrity
//     const checksum = dataBuffer ? crypto.createHash('md5').update(dataBuffer).digest('hex').substring(0, 8) : 'unknown';

//     res.json({
//       success: true,
//       timing: {
//         clientStartTime,
//         receiveStartTime,
//         receiveEndTime,
//         processingTime,
//         totalTime
//       },
//       data: {
//         size: dataSize,
//         expectedSize: testSize,
//         pattern,
//         integrity: checksum
//       },
//       performance: {
//         speedMbps: speedMbps.toFixed(3),
//         efficiency: testSize > 0 ? ((dataSize / (testSize * 1024 * 1024)) * 100).toFixed(2) : '100.00'
//       },
//       server: SERVER_INFO.name
//     });

//   } catch (error) {
//     console.error('Upload test error:', error);
//     if (!res.headersSent) {
//       res.status(500).json({
//         error: 'Upload test failed',
//         details: error.message
//       });
//     }
//   }
// });

// // Multi-connection upload endpoint
// app.post('/api/upload-multi', upload.single('file'), (req, res) => {
//   const receiveTime = getHighResolutionTime();
//   const clientStartTime = parseFloat(req.headers['x-upload-start']) || receiveTime;
//   const connectionId = req.headers['x-connection-id'] || '0';
//   const totalConnections = parseInt(req.headers['x-total-connections']) || 1;
//   const testSize = parseFloat(req.headers['x-test-size']) || 0;
//   const pattern = req.headers['x-pattern'] || 'unknown';

//   try {
//     let dataSize = 0;

//     if (req.file) {
//       dataSize = req.file.size;
//     } else if (req.body && Buffer.isBuffer(req.body)) {
//       dataSize = req.body.length;
//     } else {
//       return res.status(400).json({ error: 'No data received' });
//     }

//     const processTime = getHighResolutionTime();
//     const networkDuration = receiveTime - clientStartTime;
//     const processingDuration = processTime - receiveTime;
//     const totalDuration = processTime - clientStartTime;

//     // Calculate speed for this connection
//     const speedMbps = totalDuration > 0 ? (dataSize * 8) / (totalDuration / 1000 * 1024 * 1024) : 0;

//     res.json({
//       success: true,
//       connectionId,
//       totalConnections,
//       timing: {
//         clientStartTime,
//         receiveTime,
//         processTime,
//         networkDuration,
//         processingDuration,
//         totalDuration
//       },
//       data: {
//         size: dataSize,
//         expectedSize: testSize,
//         pattern,
//         speedMbps: speedMbps.toFixed(3)
//       },
//       server: SERVER_INFO.name
//     });

//   } catch (error) {
//     console.error('Multi-upload test error:', error);
//     if (!res.headersSent) {
//       res.status(500).json({
//         error: 'Multi-upload test failed',
//         connectionId,
//         details: error.message
//       });
//     }
//   }
// });

// // Error handling middleware
// app.use((error, req, res, next) => {
//   console.error('Server error:', error);
//   if (!res.headersSent) {
//     res.status(500).json({
//       error: 'Internal server error',
//       message: error.message,
//       timestamp: getHighResolutionTime()
//     });
//   }
// });

// // 404 handler
// app.use((req, res) => {
//   if (!res.headersSent) {
//     res.status(404).json({
//       error: 'Endpoint not found',
//       path: req.path,
//       timestamp: getHighResolutionTime()
//     });
//   }
// });

// // Start server
// const server = app.listen(PORT, () => {
//   console.log(`\n🚀 Speed Test Server`);
//   console.log(`📡 Port: ${PORT}`);
//   console.log(`🖥️  Server: ${SERVER_INFO.name}`);
//   console.log(`💻 System: ${SERVER_INFO.platform} (${SERVER_INFO.arch})`);
//   console.log(`⚡ Cores: ${SERVER_INFO.cores}`);
//   console.log(`🧠 Memory: ${SERVER_INFO.memory}`);
//   console.log(`\n📋 Available Endpoints:`);
//   console.log(`   GET  /api/ping                    - Basic ping test`);
//   console.log(`   GET  /api/info                    - Server information`);
//   console.log(`   GET  /api/latency-advanced        - Advanced latency test`);
//   console.log(`   GET  /api/warmup-advanced         - Connection warmup`);
//   console.log(`   GET  /api/download/:size          - Download test`);
//   console.log(`   GET  /api/download-adaptive       - Adaptive download test`);
//   console.log(`   POST /api/upload                  - Upload test`);
//   console.log(`   POST /api/upload-multi            - Multi-connection upload`);
//   console.log(`\n✅ Server ready for testing!\n`);
// });

// // Server optimization
// server.keepAliveTimeout = 120000;
// server.headersTimeout = 125000;
// server.timeout = 300000;

// // TCP optimization
// server.on('connection', (socket) => {
//   socket.setNoDelay(true);
//   socket.setKeepAlive(true, 60000);
// });

// module.exports = app;

// const express = require('express');
// const cors = require('cors');
// const multer = require('multer');
// const crypto = require('crypto');
// const os = require('os');
// const { performance } = require('perf_hooks');
// const app = express();

// // CORS configuration - Allow all origins for development
// app.use(cors({
//   origin: '*',
//   methods: ['GET', 'POST', 'OPTIONS'],
//   allowedHeaders: ['Content-Type', 'Authorization', 'X-Upload-Start', 'X-Connection-Id', 'X-Total-Connections', 'X-Test-Size', 'X-Pattern']
// }));

// // Middleware for parsing JSON and raw data
// app.use(express.json({ limit: '500mb' }));
// app.use(express.raw({ limit: '500mb', type: 'application/octet-stream' }));

// // Configure multer for file uploads
// const upload = multer({
//   limits: {
//     fileSize: 500 * 1024 * 1024, // 500MB
//   },
//   storage: multer.memoryStorage()
// });

// // Server configuration
// const PORT = process.env.PORT || 3001;
// const SERVER_INFO = {
//   name: 'Speed Test Server',
//   location: 'Local',
//   host: os.hostname(),
//   platform: os.platform(),
//   arch: os.arch(),
//   cores: os.cpus().length,
//   memory: Math.round(os.totalmem() / 1024 / 1024 / 1024) + 'GB'
// };

// // Test data cache for performance
// const testDataCache = new Map();

// // Generate test data with caching
// const generateTestData = (sizeInMB, pattern = 'random') => {
//   const key = `${sizeInMB}mb_${pattern}`;

//   if (!testDataCache.has(key)) {
//     const sizeInBytes = sizeInMB * 1024 * 1024;
//     let buffer;

//     switch (pattern) {
//       case 'random':
//         buffer = crypto.randomBytes(sizeInBytes);
//         break;
//       case 'compressible':
//         buffer = Buffer.alloc(sizeInBytes, 0x41);
//         break;
//       case 'incompressible':
//         buffer = Buffer.alloc(sizeInBytes);
//         for (let i = 0; i < sizeInBytes; i++) {
//           buffer[i] = (i * 137 + 19) % 256;
//         }
//         break;
//       default:
//         buffer = crypto.randomBytes(sizeInBytes);
//     }

//     testDataCache.set(key, buffer);
//   }

//   return testDataCache.get(key);
// };

// // Pre-generate common test data sizes
// const commonSizes = [1, 5, 10, 25, 50];
// commonSizes.forEach(size => {
//   generateTestData(size, 'random');
// });

// // High-resolution timestamp
// const getHighResolutionTime = () => {
//   return performance.now() + performance.timeOrigin;
// };

// // Basic ping endpoint
// app.get('/api/ping', (req, res) => {
//   const serverTime = getHighResolutionTime();
//   const clientTime = parseFloat(req.query.t) || serverTime;
//   const sequence = parseInt(req.query.seq) || 0;

//   res.json({
//     clientTime,
//     serverTime,
//     sequence,
//     server: SERVER_INFO.name
//   });
// });

// // Server info endpoint
// app.get('/api/info', (req, res) => {
//   res.json({
//     server: SERVER_INFO,
//     timestamp: getHighResolutionTime(),
//     uptime: process.uptime(),
//     memory: {
//       used: process.memoryUsage().rss,
//       total: os.totalmem(),
//       free: os.freemem()
//     }
//   });
// });

// // Enhanced latency test endpoint
// app.get('/api/latency-advanced', (req, res) => {
//   const count = Math.min(parseInt(req.query.count) || 10, 50);
//   const interval = Math.max(parseInt(req.query.interval) || 100, 50);

//   const measurements = [];
//   let completed = 0;
//   const startTime = getHighResolutionTime();

//   const performMeasurement = (index) => {
//     const measurementTime = getHighResolutionTime();

//     measurements.push({
//       index,
//       clientStartTime: startTime,
//       serverTime: measurementTime,
//       latency: measurementTime - startTime
//     });

//     completed++;

//     if (completed >= count) {
//       // Calculate statistics
//       const latencies = measurements.map(m => measurementTime - startTime + (index * interval));
//       const average = latencies.reduce((a, b) => a + b, 0) / latencies.length;
//       const min = Math.min(...latencies);
//       const max = Math.max(...latencies);
//       const jitter = max - min;

//       res.json({
//         measurements,
//         statistics: {
//           count: completed,
//           average: average.toFixed(3),
//           minimum: min.toFixed(3),
//           maximum: max.toFixed(3),
//           jitter: jitter.toFixed(3)
//         },
//         server: SERVER_INFO.name
//       });
//     } else {
//       setTimeout(() => performMeasurement(index + 1), interval);
//     }
//   };

//   performMeasurement(0);
// });

// // Warmup endpoint
// app.get('/api/warmup-advanced', (req, res) => {
//   const startTime = getHighResolutionTime();

//   res.setHeader('Content-Type', 'application/octet-stream');
//   res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
//   res.setHeader('Pragma', 'no-cache');
//   res.setHeader('Expires', '0');
//   res.setHeader('X-Warmup-Start', startTime.toString());

//   // Send warmup data in phases
//   const phases = [
//     { size: 0.1, delay: 100 },
//     { size: 0.5, delay: 150 },
//     { size: 1.0, delay: 200 },
//     { size: 2.0, delay: 250 }
//   ];

//   let currentPhase = 0;
//   let responseEnded = false; // Flag to prevent multiple endings

//   const sendPhase = () => {
//     if (responseEnded) return; // Prevent multiple operations

//     if (currentPhase >= phases.length) {
//       if (!responseEnded) {
//         responseEnded = true;
//         res.setHeader('X-Warmup-End', getHighResolutionTime().toString());
//         res.end();
//       }
//       return;
//     }

//     const phase = phases[currentPhase];
//     const phaseData = generateTestData(phase.size, 'random');

//     // Check if response is still writable
//     if (!res.writableEnded) {
//       res.write(phaseData);
//     }

//     currentPhase++;

//     if (currentPhase < phases.length) {
//       setTimeout(sendPhase, phase.delay);
//     } else {
//       // This is the last phase
//       setTimeout(() => {
//         if (!responseEnded) {
//           responseEnded = true;
//           res.setHeader('X-Warmup-End', getHighResolutionTime().toString());
//           res.end();
//         }
//       }, phase.delay);
//     }
//   };

//   // Handle client disconnect
//   req.on('close', () => {
//     responseEnded = true;
//   });

//   sendPhase();
// });
// // app.get('/api/warmup-advanced', (req, res) => {
// //   const startTime = getHighResolutionTime();

// //   res.setHeader('Content-Type', 'application/octet-stream');
// //   res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
// //   res.setHeader('Pragma', 'no-cache');
// //   res.setHeader('Expires', '0');
// //   res.setHeader('X-Warmup-Start', startTime.toString());

// //   // Send warmup data in phases
// //   const phases = [
// //     { size: 0.1, delay: 100 },
// //     { size: 0.5, delay: 150 },
// //     { size: 1.0, delay: 200 },
// //     { size: 2.0, delay: 250 }
// //   ];

// //   let currentPhase = 0;

// //   const sendPhase = () => {
// //     if (currentPhase >= phases.length) {
// //       res.setHeader('X-Warmup-End', getHighResolutionTime().toString());
// //       res.end();
// //       return;
// //     }

// //     const phase = phases[currentPhase];
// //     const phaseData = generateTestData(phase.size, 'random');

// //     res.write(phaseData);
// //     currentPhase++;

// //     if (currentPhase < phases.length) {
// //       setTimeout(sendPhase, phase.delay);
// //     } else {
// //       setTimeout(() => {
// //         res.setHeader('X-Warmup-End', getHighResolutionTime().toString());
// //         res.end();
// //       }, phase.delay);
// //     }
// //   };

// //   sendPhase();
// // });

// // Download test endpoint
// app.get('/api/download/:size', (req, res) => {
//   const size = parseFloat(req.params.size);
//   const pattern = req.query.pattern || 'random';
//   const connections = parseInt(req.query.connections) || 1;

//   if (isNaN(size) || size < 0.1 || size > 500) {
//     return res.status(400).json({ error: 'Invalid size. Must be between 0.1 and 500 MB' });
//   }

//   try {
//     const testData = generateTestData(size, pattern);
//     const startTime = getHighResolutionTime();

//     res.setHeader('Content-Type', 'application/octet-stream');
//     res.setHeader('Content-Length', testData.length.toString());
//     res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
//     res.setHeader('Pragma', 'no-cache');
//     res.setHeader('Expires', '0');
//     res.setHeader('X-Test-Start', startTime.toString());
//     res.setHeader('X-Test-Size', size.toString());
//     res.setHeader('X-Pattern', pattern);
//     res.setHeader('X-Connections', connections.toString());

//     // Stream the data in chunks for better performance
//     const chunkSize = 64 * 1024; // 64KB chunks
//     let offset = 0;
//     let responseEnded = false;

//     const sendChunk = () => {
//       if (responseEnded || res.writableEnded) return;

//       if (offset >= testData.length) {
//         if (!responseEnded) {
//           responseEnded = true;
//           res.setHeader('X-Test-End', getHighResolutionTime().toString());
//           res.end();
//         }
//         return;
//       }

//       const chunk = testData.slice(offset, Math.min(offset + chunkSize, testData.length));
//       const writeSuccess = res.write(chunk);
//       offset += chunk.length;

//       if (writeSuccess) {
//         setImmediate(sendChunk);
//       } else {
//         res.once('drain', sendChunk);
//       }
//     };

//     // Handle client disconnect
//     req.on('close', () => {
//       responseEnded = true;
//     });

//     sendChunk();

//   } catch (error) {
//     console.error('Download test error:', error);
//     if (!res.headersSent) {
//       res.status(500).json({ error: 'Failed to generate test data' });
//     }
//   }
// });
// // app.get('/api/download/:size', (req, res) => {
// //   const size = parseFloat(req.params.size);
// //   const pattern = req.query.pattern || 'random';
// //   const connections = parseInt(req.query.connections) || 1;

// //   if (isNaN(size) || size < 0.1 || size > 500) {
// //     return res.status(400).json({ error: 'Invalid size. Must be between 0.1 and 500 MB' });
// //   }

// //   try {
// //     const testData = generateTestData(size, pattern);
// //     const startTime = getHighResolutionTime();

// //     res.setHeader('Content-Type', 'application/octet-stream');
// //     res.setHeader('Content-Length', testData.length.toString());
// //     res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
// //     res.setHeader('Pragma', 'no-cache');
// //     res.setHeader('Expires', '0');
// //     res.setHeader('X-Test-Start', startTime.toString());
// //     res.setHeader('X-Test-Size', size.toString());
// //     res.setHeader('X-Pattern', pattern);
// //     res.setHeader('X-Connections', connections.toString());

// //     // Stream the data in chunks for better performance
// //     const chunkSize = 64 * 1024; // 64KB chunks
// //     let offset = 0;

// //     const sendChunk = () => {
// //       if (offset >= testData.length) {
// //         res.setHeader('X-Test-End', getHighResolutionTime().toString());
// //         res.end();
// //         return;
// //       }

// //       const chunk = testData.slice(offset, Math.min(offset + chunkSize, testData.length));
// //       const writeSuccess = res.write(chunk);
// //       offset += chunk.length;

// //       if (writeSuccess) {
// //         setImmediate(sendChunk);
// //       } else {
// //         res.once('drain', sendChunk);
// //       }
// //     };

// //     sendChunk();

// //   } catch (error) {
// //     console.error('Download test error:', error);
// //     res.status(500).json({ error: 'Failed to generate test data' });
// //   }
// // });

// // Adaptive download endpoint
// app.get('/api/download-adaptive', (req, res) => {
//   const initialSize = parseFloat(req.query.initial) || 1;
//   const maxSize = parseFloat(req.query.max) || 50;
//   const duration = parseInt(req.query.duration) || 10;
//   const pattern = req.query.pattern || 'random';

//   let currentSize = initialSize;
//   let totalSent = 0;
//   let responseEnded = false;
//   const startTime = getHighResolutionTime();

//   res.setHeader('Content-Type', 'application/octet-stream');
//   res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
//   res.setHeader('Pragma', 'no-cache');
//   res.setHeader('Expires', '0');
//   res.setHeader('X-Test-Type', 'adaptive');
//   res.setHeader('X-Start-Time', startTime.toString());
//   res.setHeader('X-Pattern', pattern);

//   const sendChunk = () => {
//     if (responseEnded || res.writableEnded) return;

//     const now = getHighResolutionTime();
//     const elapsed = (now - startTime) / 1000;

//     if (elapsed >= duration) {
//       if (!responseEnded) {
//         responseEnded = true;
//         res.setHeader('X-Total-Sent', totalSent.toString());
//         res.setHeader('X-End-Time', now.toString());
//         res.end();
//       }
//       return;
//     }

//     // Adaptive sizing based on time elapsed
//     if (elapsed > 2 && currentSize < maxSize) {
//       currentSize = Math.min(currentSize * 1.2, maxSize);
//     }

//     try {
//       const chunkData = generateTestData(currentSize, pattern);
//       if (!res.writableEnded) {
//         res.write(chunkData);
//         totalSent += chunkData.length;
//       }
//     } catch (error) {
//       console.error('Adaptive download chunk error:', error);
//       if (!responseEnded) {
//         responseEnded = true;
//         res.end();
//       }
//       return;
//     }

//     // Continue sending with small delay
//     setImmediate(sendChunk);
//   };

//   // Handle client disconnect
//   req.on('close', () => {
//     responseEnded = true;
//     console.log('Client disconnected from adaptive download');
//   });

//   sendChunk();
// });

// // app.get('/api/download-adaptive', (req, res) => {
// //   const initialSize = parseFloat(req.query.initial) || 1;
// //   const maxSize = parseFloat(req.query.max) || 50;
// //   const duration = parseInt(req.query.duration) || 10;
// //   const pattern = req.query.pattern || 'random';

// //   let currentSize = initialSize;
// //   let totalSent = 0;
// //   const startTime = getHighResolutionTime();

// //   res.setHeader('Content-Type', 'application/octet-stream');
// //   res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
// //   res.setHeader('Pragma', 'no-cache');
// //   res.setHeader('Expires', '0');
// //   res.setHeader('X-Test-Type', 'adaptive');
// //   res.setHeader('X-Start-Time', startTime.toString());
// //   res.setHeader('X-Pattern', pattern);

// //   const sendChunk = () => {
// //     const now = getHighResolutionTime();
// //     const elapsed = (now - startTime) / 1000;

// //     if (elapsed >= duration) {
// //       res.setHeader('X-Total-Sent', totalSent.toString());
// //       res.setHeader('X-End-Time', now.toString());
// //       res.end();
// //       return;
// //     }

// //     // Adaptive sizing based on time elapsed
// //     if (elapsed > 2 && currentSize < maxSize) {
// //       currentSize = Math.min(currentSize * 1.2, maxSize);
// //     }

// //     const chunkData = generateTestData(currentSize, pattern);
// //     res.write(chunkData);
// //     totalSent += chunkData.length;

// //     // Continue sending with small delay
// //     setImmediate(sendChunk);
// //   };

// //   sendChunk();

// //   req.on('close', () => {
// //     // Client disconnected
// //     console.log('Client disconnected from adaptive download');
// //   });
// // });

// // Upload test endpoint
// app.post('/api/upload', upload.single('file'), (req, res) => {
//   const receiveStartTime = getHighResolutionTime();
//   const clientStartTime = parseFloat(req.headers['x-upload-start']) || receiveStartTime;
//   const testSize = parseFloat(req.headers['x-test-size']) || 0;
//   const pattern = req.headers['x-pattern'] || 'unknown';

//   try {
//     let dataSize = 0;
//     let dataBuffer = null;

//     if (req.file) {
//       dataSize = req.file.size;
//       dataBuffer = req.file.buffer;
//     } else if (req.body && Buffer.isBuffer(req.body)) {
//       dataSize = req.body.length;
//       dataBuffer = req.body;
//     } else {
//       return res.status(400).json({ error: 'No data received' });
//     }

//     const receiveEndTime = getHighResolutionTime();
//     const processingTime = receiveEndTime - receiveStartTime;
//     const totalTime = receiveEndTime - clientStartTime;

//     // Calculate upload speed
//     const speedMbps = totalTime > 0 ? (dataSize * 8) / (totalTime / 1000 * 1024 * 1024) : 0;

//     // Generate a simple checksum for data integrity
//     const checksum = dataBuffer ? crypto.createHash('md5').update(dataBuffer).digest('hex').substring(0, 8) : 'unknown';

//     res.json({
//       success: true,
//       timing: {
//         clientStartTime,
//         receiveStartTime,
//         receiveEndTime,
//         processingTime,
//         totalTime
//       },
//       data: {
//         size: dataSize,
//         expectedSize: testSize,
//         pattern,
//         integrity: checksum
//       },
//       performance: {
//         speedMbps: speedMbps.toFixed(3),
//         efficiency: testSize > 0 ? ((dataSize / (testSize * 1024 * 1024)) * 100).toFixed(2) : '100.00'
//       },
//       server: SERVER_INFO.name
//     });

//   } catch (error) {
//     console.error('Upload test error:', error);
//     res.status(500).json({
//       error: 'Upload test failed',
//       details: error.message
//     });
//   }
// });

// // Multi-connection upload endpoint
// app.post('/api/upload-multi', upload.single('file'), (req, res) => {
//   const receiveTime = getHighResolutionTime();
//   const clientStartTime = parseFloat(req.headers['x-upload-start']) || receiveTime;
//   const connectionId = req.headers['x-connection-id'] || '0';
//   const totalConnections = parseInt(req.headers['x-total-connections']) || 1;
//   const testSize = parseFloat(req.headers['x-test-size']) || 0;
//   const pattern = req.headers['x-pattern'] || 'unknown';

//   try {
//     let dataSize = 0;

//     if (req.file) {
//       dataSize = req.file.size;
//     } else if (req.body && Buffer.isBuffer(req.body)) {
//       dataSize = req.body.length;
//     } else {
//       return res.status(400).json({ error: 'No data received' });
//     }

//     const processTime = getHighResolutionTime();
//     const networkDuration = receiveTime - clientStartTime;
//     const processingDuration = processTime - receiveTime;
//     const totalDuration = processTime - clientStartTime;

//     // Calculate speed for this connection
//     const speedMbps = totalDuration > 0 ? (dataSize * 8) / (totalDuration / 1000 * 1024 * 1024) : 0;

//     res.json({
//       success: true,
//       connectionId,
//       totalConnections,
//       timing: {
//         clientStartTime,
//         receiveTime,
//         processTime,
//         networkDuration,
//         processingDuration,
//         totalDuration
//       },
//       data: {
//         size: dataSize,
//         expectedSize: testSize,
//         pattern,
//         speedMbps: speedMbps.toFixed(3)
//       },
//       server: SERVER_INFO.name
//     });

//   } catch (error) {
//     console.error('Multi-upload test error:', error);
//     res.status(500).json({
//       error: 'Multi-upload test failed',
//       connectionId,
//       details: error.message
//     });
//   }
// });

// // Error handling middleware
// app.use((error, req, res, next) => {
//   console.error('Server error:', error);
//   res.status(500).json({
//     error: 'Internal server error',
//     message: error.message,
//     timestamp: getHighResolutionTime()
//   });
// });

// // 404 handler
// app.use((req, res) => {
//   res.status(404).json({
//     error: 'Endpoint not found',
//     path: req.path,
//     timestamp: getHighResolutionTime()
//   });
// });

// // Start server
// const server = app.listen(PORT, () => {
//   console.log(`\n🚀 Speed Test Server`);
//   console.log(`📡 Port: ${PORT}`);
//   console.log(`🖥️  Server: ${SERVER_INFO.name}`);
//   console.log(`💻 System: ${SERVER_INFO.platform} (${SERVER_INFO.arch})`);
//   console.log(`⚡ Cores: ${SERVER_INFO.cores}`);
//   console.log(`🧠 Memory: ${SERVER_INFO.memory}`);
//   console.log(`\n📋 Available Endpoints:`);
//   console.log(`   GET  /api/ping                    - Basic ping test`);
//   console.log(`   GET  /api/info                    - Server information`);
//   console.log(`   GET  /api/latency-advanced        - Advanced latency test`);
//   console.log(`   GET  /api/warmup-advanced         - Connection warmup`);
//   console.log(`   GET  /api/download/:size          - Download test`);
//   console.log(`   GET  /api/download-adaptive       - Adaptive download test`);
//   console.log(`   POST /api/upload                  - Upload test`);
//   console.log(`   POST /api/upload-multi            - Multi-connection upload`);
//   console.log(`\n✅ Server ready for testing!\n`);
// });

// // Server optimization
// server.keepAliveTimeout = 120000;
// server.headersTimeout = 125000;
// server.timeout = 300000;

// // TCP optimization
// server.on('connection', (socket) => {
//   socket.setNoDelay(true);
//   socket.setKeepAlive(true, 60000);
// });

// module.exports = app;

// const express = require('express');
// const cors = require('cors');
// const multer = require('multer');
// const crypto = require('crypto');
// const os = require('os');
// const cluster = require('cluster');
// const { performance } = require('perf_hooks');
// const { Transform } = require('stream');
// const app = express();

// // Advanced middleware configuration
// app.use(cors({
//   origin: '*',
//   methods: ['GET', 'POST', 'OPTIONS'],
//   allowedHeaders: ['Content-Type', 'Authorization', 'X-Upload-Start', 'X-Connection-Id', 'X-Total-Connections', 'X-Test-Size', 'X-Chunk-Size']
// }));

// app.use(express.json({ limit: '500mb' }));
// app.use(express.raw({ limit: '500mb', type: 'application/octet-stream' }));

// // Configure multer with optimized settings
// const upload = multer({
//   limits: {
//     fileSize: 500 * 1024 * 1024, // 500MB limit
//     fieldSize: 500 * 1024 * 1024,
//   },
//   storage: multer.memoryStorage()
// });

// // Server configuration with optimizations
// const PORT = process.env.PORT || 3001;
// const SERVER_INFO = {
//   name: 'High-Precision Speed Test Server',
//   location: 'Auto-detected',
//   host: os.hostname(),
//   platform: os.platform(),
//   arch: os.arch(),
//   cores: os.cpus().length,
//   memory: Math.round(os.totalmem() / 1024 / 1024 / 1024) + 'GB'
// };

// // High-performance test data cache with multiple patterns
// const testDataCache = new Map();
// const generateOptimizedTestData = (sizeInMB, pattern = 'random') => {
//   const key = `${sizeInMB}mb_${pattern}`;
//   if (!testDataCache.has(key)) {
//     const sizeInBytes = sizeInMB * 1024 * 1024;
//     let buffer;

//     switch (pattern) {
//       case 'random':
//         buffer = crypto.randomBytes(sizeInBytes);
//         break;
//       case 'compressible':
//         buffer = Buffer.alloc(sizeInBytes, 0x41); // Repeating 'A'
//         break;
//       case 'incompressible':
//         buffer = Buffer.alloc(sizeInBytes);
//         for (let i = 0; i < sizeInBytes; i++) {
//           buffer[i] = (i * 137 + 19) % 256; // Pseudo-random pattern
//         }
//         break;
//       default:
//         buffer = crypto.randomBytes(sizeInBytes);
//     }

//     testDataCache.set(key, buffer);
//   }
//   return testDataCache.get(key);
// };

// // Pre-generate test data for various sizes and patterns
// const commonSizes = [0.5, 1, 2, 5, 10, 25, 50, 100, 200];
// const patterns = ['random', 'compressible', 'incompressible'];

// commonSizes.forEach(size => {
//   patterns.forEach(pattern => {
//     generateOptimizedTestData(size, pattern);
//   });
// });

// // Enhanced streaming class for precise bandwidth control
// class PrecisionSpeedStream extends Transform {
//   constructor(options) {
//     super(options);
//     this.totalBytes = 0;
//     this.startTime = performance.now();
//     this.lastChunkTime = this.startTime;
//     this.chunkSize = options.chunkSize || 32 * 1024; // 32KB chunks
//     this.targetBandwidth = options.targetBandwidth || 0; // 0 = unlimited
//     this.bytesThisSecond = 0;
//     this.lastSecondStart = this.startTime;
//   }

//   _transform(chunk, encoding, callback) {
//     const now = performance.now();
//     const timeSinceLastSecond = now - this.lastSecondStart;

//     if (timeSinceLastSecond >= 1000) {
//       this.bytesThisSecond = 0;
//       this.lastSecondStart = now;
//     }

//     this.totalBytes += chunk.length;
//     this.bytesThisSecond += chunk.length;

//     // Bandwidth limiting if specified
//     if (this.targetBandwidth > 0) {
//       const targetBytesPerSecond = this.targetBandwidth * 1024 * 1024 / 8;
//       if (this.bytesThisSecond > targetBytesPerSecond) {
//         const delay = Math.max(0, 1000 - timeSinceLastSecond);
//         setTimeout(() => {
//           this.push(chunk);
//           callback();
//         }, delay);
//         return;
//       }
//     }

//     this.push(chunk);
//     callback();
//   }
// }

// // Precise timing utilities
// const getHighResolutionTime = () => {
//   return performance.now() + performance.timeOrigin;
// };

// // Advanced ping endpoint with sub-millisecond precision
// app.get('/api/ping', (req, res) => {
//   const serverReceiveTime = getHighResolutionTime();
//   const clientSendTime = parseFloat(req.query.t) || serverReceiveTime;

//   res.json({
//     clientSendTime,
//     serverReceiveTime,
//     serverSendTime: getHighResolutionTime(),
//     server: SERVER_INFO.name,
//     sequence: parseInt(req.query.seq) || 0
//   });
// });

// // Enhanced server info with network interfaces
// app.get('/api/info', (req, res) => {
//   const networkInterfaces = os.networkInterfaces();
//   const activeInterfaces = {};

//   Object.keys(networkInterfaces).forEach(name => {
//     const interfaces = networkInterfaces[name].filter(iface =>
//       !iface.internal && iface.family === 'IPv4'
//     );
//     if (interfaces.length > 0) {
//       activeInterfaces[name] = interfaces[0];
//     }
//   });

//   res.json({
//     server: SERVER_INFO,
//     timestamp: getHighResolutionTime(),
//     uptime: process.uptime(),
//     memory: {
//       ...process.memoryUsage(),
//       total: os.totalmem(),
//       free: os.freemem()
//     },
//     network: {
//       interfaces: activeInterfaces,
//       hostname: os.hostname()
//     },
//     performance: {
//       eventLoopDelay: process.hrtime.bigint(),
//       cpuUsage: process.cpuUsage()
//     }
//   });
// });

// // Multi-phase download test with adaptive sizing
// app.get('/api/download-adaptive', (req, res) => {
//   const initialSize = parseFloat(req.query.initial) || 1; // MB
//   const maxSize = parseFloat(req.query.max) || 100; // MB
//   const duration = parseInt(req.query.duration) || 10; // seconds
//   const pattern = req.query.pattern || 'random';

//   let currentSize = initialSize;
//   let totalSent = 0;
//   const startTime = getHighResolutionTime();
//   let lastSpeedCalculation = startTime;
//   let lastBytesSent = 0;

//   res.setHeader('Content-Type', 'application/octet-stream');
//   res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
//   res.setHeader('Pragma', 'no-cache');
//   res.setHeader('Expires', '0');
//   res.setHeader('X-Test-Type', 'adaptive');
//   res.setHeader('X-Start-Time', startTime.toString());
//   res.setHeader('X-Pattern', pattern);

//   const sendChunk = () => {
//     const now = getHighResolutionTime();
//     const elapsed = (now - startTime) / 1000;

//     if (elapsed >= duration) {
//       res.end();
//       return;
//     }

//     // Calculate current speed and adapt chunk size
//     if (now - lastSpeedCalculation >= 1000) {
//       const bytesSinceLastCalc = totalSent - lastBytesSent;
//       const timeSinceLastCalc = (now - lastSpeedCalculation) / 1000;
//       const currentSpeedMbps = (bytesSinceLastCalc * 8) / (timeSinceLastCalc * 1024 * 1024);

//       // Adaptive sizing based on current speed
//       if (currentSpeedMbps > 50 && currentSize < maxSize) {
//         currentSize = Math.min(currentSize * 1.5, maxSize);
//       } else if (currentSpeedMbps < 10 && currentSize > 1) {
//         currentSize = Math.max(currentSize * 0.8, 1);
//       }

//       lastSpeedCalculation = now;
//       lastBytesSent = totalSent;
//     }

//     const chunkData = generateOptimizedTestData(currentSize, pattern);
//     res.write(chunkData);
//     totalSent += chunkData.length;

//     // Continue sending
//     setImmediate(sendChunk);
//   };

//   sendChunk();

//   req.on('close', () => {
//     // Client disconnected
//   });
// });

// // High-precision download endpoint with multiple patterns
// app.get('/api/download/:size', (req, res) => {
//   const size = parseFloat(req.params.size);
//   const pattern = req.query.pattern || 'random';
//   const chunkSize = parseInt(req.query.chunk) || 64 * 1024; // 64KB default
//   const connections = parseInt(req.query.connections) || 1;

//   if (isNaN(size) || size < 0.1 || size > 500) {
//     return res.status(400).json({ error: 'Invalid size. Must be between 0.1 and 500 MB' });
//   }

//   try {
//     const testData = generateOptimizedTestData(size, pattern);
//     const startTime = getHighResolutionTime();

//     // Optimized headers
//     res.setHeader('Content-Type', 'application/octet-stream');
//     res.setHeader('Content-Length', testData.length.toString());
//     res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
//     res.setHeader('Pragma', 'no-cache');
//     res.setHeader('Expires', '0');
//     res.setHeader('X-Test-Start', startTime.toString());
//     res.setHeader('X-Test-Size', size.toString());
//     res.setHeader('X-Pattern', pattern);
//     res.setHeader('X-Chunk-Size', chunkSize.toString());
//     res.setHeader('X-Connections', connections.toString());
//     res.setHeader('Accept-Ranges', 'bytes');

//     // High-performance streaming
//     let offset = 0;
//     let bytesSent = 0;
//     let lastProgressTime = startTime;

//     const sendChunk = () => {
//       const now = getHighResolutionTime();

//       if (offset >= testData.length) {
//         res.setHeader('X-Test-End', now.toString());
//         res.setHeader('X-Total-Bytes', bytesSent.toString());
//         res.end();
//         return;
//       }

//       const chunk = testData.slice(offset, Math.min(offset + chunkSize, testData.length));
//       const writeSuccess = res.write(chunk);
//       offset += chunk.length;
//       bytesSent += chunk.length;

//       // Progress reporting
//       if (now - lastProgressTime >= 100) { // Every 100ms
//         const progress = (offset / testData.length) * 100;
//         const elapsed = (now - startTime) / 1000;
//         const currentSpeed = elapsed > 0 ? (bytesSent * 8) / (elapsed * 1024 * 1024) : 0;

//         res.setHeader('X-Progress', progress.toFixed(2));
//         res.setHeader('X-Current-Speed', currentSpeed.toFixed(2));
//         lastProgressTime = now;
//       }

//       if (writeSuccess) {
//         setImmediate(sendChunk);
//       } else {
//         res.once('drain', sendChunk);
//       }
//     };

//     sendChunk();

//   } catch (error) {
//     console.error('Download test error:', error);
//     res.status(500).json({ error: 'Failed to generate test data' });
//   }
// });

// // High-precision upload endpoint with better timing
// app.post('/api/upload', upload.single('testfile'), (req, res) => {
//   const receiveStartTime = getHighResolutionTime();
//   const clientStartTime = parseFloat(req.headers['x-upload-start']) || receiveStartTime;
//   const testSize = parseFloat(req.headers['x-test-size']) || 0;
//   const chunkSize = parseInt(req.headers['x-chunk-size']) || 0;
//   const pattern = req.headers['x-pattern'] || 'unknown';

//   try {
//     let dataSize = 0;
//     let dataBuffer = null;

//     if (req.file) {
//       dataSize = req.file.size;
//       dataBuffer = req.file.buffer;
//     } else if (req.body && Buffer.isBuffer(req.body)) {
//       dataSize = req.body.length;
//       dataBuffer = req.body;
//     } else {
//       return res.status(400).json({ error: 'No data received' });
//     }

//     const receiveEndTime = getHighResolutionTime();
//     const processingStartTime = receiveEndTime;

//     // Validate data integrity if possible
//     let dataIntegrity = 'unknown';
//     if (dataBuffer && dataSize > 0) {
//       // Simple checksum validation
//       const checksum = crypto.createHash('md5').update(dataBuffer).digest('hex');
//       dataIntegrity = checksum.substring(0, 8);
//     }

//     const processingEndTime = getHighResolutionTime();

//     // Calculate various timing metrics
//     const networkTime = receiveEndTime - clientStartTime;
//     const processingTime = processingEndTime - processingStartTime;
//     const totalTime = processingEndTime - clientStartTime;

//     // Calculate speeds
//     const networkSpeedMbps = networkTime > 0 ? (dataSize * 8) / (networkTime / 1000 * 1024 * 1024) : 0;
//     const effectiveSpeedMbps = totalTime > 0 ? (dataSize * 8) / (totalTime / 1000 * 1024 * 1024) : 0;

//     res.json({
//       success: true,
//       timing: {
//         clientStartTime,
//         receiveStartTime,
//         receiveEndTime,
//         processingStartTime,
//         processingEndTime,
//         networkTime,
//         processingTime,
//         totalTime
//       },
//       data: {
//         size: dataSize,
//         expectedSize: testSize,
//         chunkSize,
//         pattern,
//         integrity: dataIntegrity
//       },
//       performance: {
//         networkSpeedMbps: networkSpeedMbps.toFixed(3),
//         effectiveSpeedMbps: effectiveSpeedMbps.toFixed(3),
//         efficiency: testSize > 0 ? ((dataSize / (testSize * 1024 * 1024)) * 100).toFixed(2) : 100
//       },
//       server: SERVER_INFO.name
//     });

//   } catch (error) {
//     console.error('Upload test error:', error);
//     res.status(500).json({
//       error: 'Upload test failed',
//       details: error.message
//     });
//   }
// });

// // Multi-connection upload coordinator
// app.post('/api/upload-multi', upload.single('testfile'), (req, res) => {
//   const receiveTime = getHighResolutionTime();
//   const clientStartTime = parseFloat(req.headers['x-upload-start']) || receiveTime;
//   const connectionId = req.headers['x-connection-id'] || '0';
//   const totalConnections = parseInt(req.headers['x-total-connections']) || 1;
//   const testPhase = req.headers['x-test-phase'] || 'single';

//   try {
//     let dataSize = 0;

//     if (req.file) {
//       dataSize = req.file.size;
//     } else if (req.body && Buffer.isBuffer(req.body)) {
//       dataSize = req.body.length;
//     }

//     const processTime = getHighResolutionTime();
//     const networkDuration = receiveTime - clientStartTime;
//     const processingDuration = processTime - receiveTime;

//     res.json({
//       success: true,
//       connectionId,
//       totalConnections,
//       testPhase,
//       timing: {
//         clientStartTime,
//         receiveTime,
//         processTime,
//         networkDuration,
//         processingDuration
//       },
//       data: {
//         size: dataSize,
//         speedMbps: networkDuration > 0 ? (dataSize * 8) / (networkDuration / 1000 * 1024 * 1024) : 0
//       },
//       server: SERVER_INFO.name
//     });

//   } catch (error) {
//     console.error('Multi-upload test error:', error);
//     res.status(500).json({
//       error: 'Multi-upload test failed',
//       connectionId,
//       details: error.message
//     });
//   }
// });

// // Advanced latency test with statistical analysis
// app.get('/api/latency-advanced', (req, res) => {
//   const count = Math.min(parseInt(req.query.count) || 20, 100);
//   const interval = Math.max(parseInt(req.query.interval) || 100, 50);
//   const clientStartTime = parseFloat(req.query.start) || getHighResolutionTime();

//   const measurements = [];
//   let completed = 0;

//   const performMeasurement = (index) => {
//     const serverTime = getHighResolutionTime();
//     measurements.push({
//       index,
//       serverTime,
//       clientStartTime,
//       roundTripStart: serverTime
//     });

//     completed++;

//     if (completed >= count) {
//       // Calculate statistics
//       const times = measurements.map(m => m.serverTime - clientStartTime);
//       const avg = times.reduce((a, b) => a + b, 0) / times.length;
//       const min = Math.min(...times);
//       const max = Math.max(...times);
//       const jitter = max - min;

//       // Standard deviation
//       const variance = times.reduce((acc, time) => acc + Math.pow(time - avg, 2), 0) / times.length;
//       const stdDev = Math.sqrt(variance);

//       // Packet loss simulation (always 0 for HTTP)
//       const packetLoss = 0;

//       res.json({
//         measurements,
//         statistics: {
//           count: completed,
//           average: avg.toFixed(3),
//           minimum: min.toFixed(3),
//           maximum: max.toFixed(3),
//           jitter: jitter.toFixed(3),
//           standardDeviation: stdDev.toFixed(3),
//           packetLoss: packetLoss.toFixed(2)
//         },
//         server: SERVER_INFO.name,
//         testDuration: (getHighResolutionTime() - measurements[0].serverTime).toFixed(3)
//       });
//     } else {
//       setTimeout(() => performMeasurement(index + 1), interval);
//     }
//   };

//   performMeasurement(0);
// });

// // TCP connection warmup with congestion window optimization
// app.get('/api/warmup-advanced', (req, res) => {
//   const phases = [
//     { size: 0.1, name: 'Initial' },
//     { size: 0.5, name: 'Ramp-up' },
//     { size: 1.0, name: 'Stabilization' },
//     { size: 2.0, name: 'Optimization' }
//   ];

//   let currentPhase = 0;
//   const startTime = getHighResolutionTime();

//   res.setHeader('Content-Type', 'application/octet-stream');
//   res.setHeader('Cache-Control', 'no-cache');
//   res.setHeader('X-Warmup-Type', 'advanced');
//   res.setHeader('X-Warmup-Start', startTime.toString());

//   const sendPhase = () => {
//     if (currentPhase >= phases.length) {
//       res.setHeader('X-Warmup-End', getHighResolutionTime().toString());
//       res.setHeader('X-Warmup-Duration', (getHighResolutionTime() - startTime).toString());
//       res.end();
//       return;
//     }

//     const phase = phases[currentPhase];
//     const phaseData = generateOptimizedTestData(phase.size, 'random');
//     const phaseStart = getHighResolutionTime();

//     res.setHeader(`X-Phase-${currentPhase}`, `${phase.name}:${phaseStart}`);
//     res.write(phaseData);

//     currentPhase++;
//     setTimeout(sendPhase, 200); // 200ms between phases
//   };

//   sendPhase();
// });

// // Real-time monitoring with system metrics
// app.get('/api/monitor', (req, res) => {
//   const duration = Math.min(parseInt(req.query.duration) || 30, 300); // Max 5 minutes
//   const interval = Math.max(parseInt(req.query.interval) || 1000, 500); // Min 500ms

//   res.setHeader('Content-Type', 'text/event-stream');
//   res.setHeader('Cache-Control', 'no-cache');
//   res.setHeader('Connection', 'keep-alive');
//   res.setHeader('Access-Control-Allow-Origin', '*');

//   let counter = 0;
//   const maxCount = Math.ceil(duration * 1000 / interval);
//   const startTime = getHighResolutionTime();

//   const sendMonitoringData = () => {
//     if (counter >= maxCount) {
//       res.write('data: {"type": "complete"}\n\n');
//       res.end();
//       return;
//     }

//     const now = getHighResolutionTime();
//     const memUsage = process.memoryUsage();
//     const cpuUsage = process.cpuUsage();

//     const data = {
//       type: 'monitor',
//       timestamp: now,
//       counter,
//       elapsed: now - startTime,
//       system: {
//         memory: {
//           used: memUsage.rss,
//           heap: memUsage.heapUsed,
//           external: memUsage.external,
//           total: os.totalmem(),
//           free: os.freemem(),
//           usage: ((os.totalmem() - os.freemem()) / os.totalmem() * 100).toFixed(2)
//         },
//         cpu: {
//           user: cpuUsage.user,
//           system: cpuUsage.system,
//           loadAvg: os.loadavg()
//         },
//         network: {
//           hostname: os.hostname(),
//           uptime: os.uptime()
//         }
//       },
//       server: SERVER_INFO
//     };

//     res.write(`data: ${JSON.stringify(data)}\n\n`);
//     counter++;
//   };

//   sendMonitoringData();
//   const monitorInterval = setInterval(sendMonitoringData, interval);

//   req.on('close', () => {
//     clearInterval(monitorInterval);
//   });
// });

// // Error handling middleware
// app.use((error, req, res, next) => {
//   console.error('Server error:', error);
//   res.status(500).json({
//     error: 'Internal server error',
//     message: error.message,
//     timestamp: getHighResolutionTime()
//   });
// });

// // 404 handler
// app.use((req, res) => {
//   res.status(404).json({
//     error: 'Endpoint not found',
//     path: req.path,
//     timestamp: getHighResolutionTime()
//   });
// });

// // Start server with optimized settings
// const server = app.listen(PORT, () => {
//   console.log(`\n🚀 Enhanced Speed Test Server v2.0`);
//   console.log(`📡 Port: ${PORT}`);
//   console.log(`🖥️  Server: ${SERVER_INFO.name}`);
//   console.log(`💻 System: ${SERVER_INFO.platform} (${SERVER_INFO.arch})`);
//   console.log(`⚡ Cores: ${SERVER_INFO.cores}`);
//   console.log(`🧠 Memory: ${SERVER_INFO.memory}`);
//   console.log(`\n📋 Available Endpoints:`);
//   console.log(`   GET  /api/ping                    - High-precision ping`);
//   console.log(`   GET  /api/info                    - Detailed server info`);
//   console.log(`   GET  /api/download/:size          - Optimized download test`);
//   console.log(`   GET  /api/download-adaptive       - Adaptive download test`);
//   console.log(`   POST /api/upload                  - High-precision upload`);
//   console.log(`   POST /api/upload-multi            - Multi-connection upload`);
//   console.log(`   GET  /api/latency-advanced        - Advanced latency test`);
//   console.log(`   GET  /api/warmup-advanced         - TCP warmup optimization`);
//   console.log(`   GET  /api/monitor                 - Real-time monitoring`);
//   console.log(`\n✅ Server ready for high-precision testing!\n`);
// });

// // Optimize server performance
// server.keepAliveTimeout = 120000; // 2 minutes
// server.headersTimeout = 125000;   // 2 minutes + 5 seconds
// server.timeout = 300000;          // 5 minutes
// server.maxConnections = 10000;    // High connection limit

// // TCP optimization
// server.on('connection', (socket) => {
//   socket.setNoDelay(true);
//   socket.setKeepAlive(true, 60000);

//   // TCP buffer optimization
//   if (socket.setRecvBufferSize) {
//     socket.setRecvBufferSize(65536);
//   }
//   if (socket.setSendBufferSize) {
//     socket.setSendBufferSize(65536);
//   }
// });

// module.exports = app;

// const express = require('express');
// const cors = require('cors');
// const multer = require('multer');
// const crypto = require('crypto');
// const os = require('os');
// const { Transform } = require('stream');
// const app = express();

// // Middleware
// app.use(cors());
// app.use(express.json({ limit: '200mb' }));
// app.use(express.raw({ limit: '200mb', type: 'application/octet-stream' }));

// // Configure multer for file uploads
// const upload = multer({
//   limits: {
//     fileSize: 200 * 1024 * 1024, // 200MB limit
//   },
//   storage: multer.memoryStorage()
// });

// // Server configuration
// const PORT = process.env.PORT || 3001;
// const SERVER_INFO = {
//   name: 'Speed Test Server',
//   location: 'Auto-detected',
//   host: os.hostname(),
//   platform: os.platform(),
//   arch: os.arch()
// };

// // Pre-generate test data buffers for better performance
// const testDataCache = new Map();
// const generateTestData = (sizeInMB) => {
//   const key = `${sizeInMB}mb`;
//   if (!testDataCache.has(key)) {
//     const sizeInBytes = sizeInMB * 1024 * 1024;
//     const buffer = crypto.randomBytes(sizeInBytes);
//     testDataCache.set(key, buffer);
//   }
//   return testDataCache.get(key);
// };

// // Pre-generate common sizes
// [1, 5, 10, 25, 50, 100].forEach(size => generateTestData(size));

// // Custom streaming transform for controlled data delivery
// class SpeedTestStream extends Transform {
//   constructor(options) {
//     super(options);
//     this.totalBytes = 0;
//     this.startTime = Date.now();
//     this.chunkSize = options.chunkSize || 64 * 1024; // 64KB chunks
//     this.targetSize = options.targetSize || 0;
//   }

//   _transform(chunk, encoding, callback) {
//     this.totalBytes += chunk.length;

//     // Add artificial delay for more realistic network simulation
//     if (this.totalBytes > this.chunkSize) {
//       setTimeout(() => {
//         this.push(chunk);
//         callback();
//       }, 1);
//     } else {
//       this.push(chunk);
//       callback();
//     }
//   }
// }

// // Routes

// // Health check / Ping endpoint
// app.get('/api/ping', (req, res) => {
//   const timestamp = Date.now();
//   res.json({
//     timestamp,
//     server: SERVER_INFO.name,
//     pong: 'pong'
//   });
// });

// // Get server information
// app.get('/api/info', (req, res) => {
//   res.json({
//     server: SERVER_INFO,
//     timestamp: Date.now(),
//     uptime: process.uptime(),
//     memory: process.memoryUsage(),
//     network: {
//       interfaces: Object.keys(os.networkInterfaces())
//     }
//   });
// });

// // Get available test servers
// app.get('/api/servers', (req, res) => {
//   res.json([
//     {
//       id: 1,
//       name: SERVER_INFO.name,
//       location: SERVER_INFO.location,
//       host: req.get('host'),
//       distance: 0,
//       ping: null
//     }
//   ]);
// });

// // Progressive download test with multiple chunk sizes
// app.get('/api/download-progressive', (req, res) => {
//   const phases = [
//     { size: 1, duration: 2000 },   // 1MB for 2 seconds
//     { size: 5, duration: 3000 },   // 5MB for 3 seconds
//     { size: 10, duration: 5000 },  // 10MB for 5 seconds
//     { size: 25, duration: 10000 }  // 25MB for 10 seconds
//   ];

//   let currentPhase = 0;
//   let totalSent = 0;
//   const startTime = Date.now();

//   res.setHeader('Content-Type', 'application/octet-stream');
//   res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
//   res.setHeader('Pragma', 'no-cache');
//   res.setHeader('Expires', '0');
//   res.setHeader('X-Test-Type', 'progressive');
//   res.setHeader('X-Start-Time', startTime.toString());

//   const sendPhase = () => {
//     if (currentPhase >= phases.length) {
//       res.end();
//       return;
//     }

//     const phase = phases[currentPhase];
//     const testData = generateTestData(phase.size);
//     const phaseStart = Date.now();

//     res.write(testData);
//     totalSent += testData.length;

//     setTimeout(() => {
//       currentPhase++;
//       sendPhase();
//     }, phase.duration);
//   };

//   sendPhase();

//   req.on('close', () => {
//     // Client disconnected
//   });
// });

// // Improved download speed test with chunked delivery
// app.get('/api/download/:size', (req, res) => {
//   const size = parseInt(req.params.size);
//   const concurrent = parseInt(req.query.concurrent) || 1;

//   if (isNaN(size) || size < 1 || size > 200) {
//     return res.status(400).json({ error: 'Invalid size. Must be between 1 and 200 MB' });
//   }

//   try {
//     const testData = generateTestData(size);
//     const startTime = Date.now();

//     // Set headers for proper speed testing
//     res.setHeader('Content-Type', 'application/octet-stream');
//     res.setHeader('Content-Length', testData.length.toString());
//     res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
//     res.setHeader('Pragma', 'no-cache');
//     res.setHeader('Expires', '0');
//     res.setHeader('X-Test-Start', startTime.toString());
//     res.setHeader('X-Test-Size', size.toString());
//     res.setHeader('X-Concurrent', concurrent.toString());

//     // Stream the data in chunks for better accuracy
//     const chunkSize = 64 * 1024; // 64KB chunks
//     let offset = 0;

//     const sendChunk = () => {
//       if (offset >= testData.length) {
//         res.end();
//         return;
//       }

//       const chunk = testData.slice(offset, Math.min(offset + chunkSize, testData.length));
//       res.write(chunk);
//       offset += chunk.length;

//       // Use setImmediate for better performance
//       setImmediate(sendChunk);
//     };

//     sendChunk();

//   } catch (error) {
//     console.error('Download test error:', error);
//     res.status(500).json({ error: 'Failed to generate test data' });
//   }
// });

// // Multi-connection download endpoint
// app.get('/api/download-multi/:size/:connections', (req, res) => {
//   const size = parseInt(req.params.size);
//   const connections = Math.min(parseInt(req.params.connections) || 4, 8); // Max 8 connections

//   if (isNaN(size) || size < 1 || size > 200) {
//     return res.status(400).json({ error: 'Invalid size. Must be between 1 and 200 MB' });
//   }

//   const chunkSize = Math.ceil(size / connections);
//   const testData = generateTestData(chunkSize);
//   const startTime = Date.now();

//   res.setHeader('Content-Type', 'application/octet-stream');
//   res.setHeader('Content-Length', testData.length.toString());
//   res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
//   res.setHeader('Pragma', 'no-cache');
//   res.setHeader('Expires', '0');
//   res.setHeader('X-Test-Start', startTime.toString());
//   res.setHeader('X-Connection-Id', req.query.connId || '0');
//   res.setHeader('X-Total-Connections', connections.toString());

//   // Send data immediately
//   res.send(testData);
// });

// // Improved upload speed test with better timing
// app.post('/api/upload', upload.single('testfile'), (req, res) => {
//   // Record precise timing
//   const receiveTime = Date.now();
//   const startTime = parseInt(req.headers['x-upload-start']) || receiveTime;

//   try {
//     let dataSize = 0;

//     if (req.file) {
//       dataSize = req.file.size;
//     } else if (req.body && Buffer.isBuffer(req.body)) {
//       dataSize = req.body.length;
//     } else if (req.body && req.body.data) {
//       dataSize = Buffer.byteLength(JSON.stringify(req.body.data));
//     } else {
//       return res.status(400).json({ error: 'No data received' });
//     }

//     const processingTime = Date.now() - receiveTime;
//     const totalDuration = receiveTime - startTime;

//     res.json({
//       success: true,
//       dataSize,
//       duration: totalDuration,
//       processingTime,
//       receiveTime,
//       startTime,
//       server: SERVER_INFO.name
//     });

//   } catch (error) {
//     console.error('Upload test error:', error);
//     res.status(500).json({ error: 'Upload test failed' });
//   }
// });

// // Multi-connection upload endpoint
// app.post('/api/upload-multi', upload.single('testfile'), (req, res) => {
//   const receiveTime = Date.now();
//   const startTime = parseInt(req.headers['x-upload-start']) || receiveTime;
//   const connectionId = req.headers['x-connection-id'] || '0';
//   const totalConnections = parseInt(req.headers['x-total-connections']) || 1;

//   try {
//     let dataSize = 0;

//     if (req.file) {
//       dataSize = req.file.size;
//     } else if (req.body && Buffer.isBuffer(req.body)) {
//       dataSize = req.body.length;
//     }

//     const duration = receiveTime - startTime;

//     res.json({
//       success: true,
//       dataSize,
//       duration,
//       receiveTime,
//       startTime,
//       connectionId,
//       totalConnections,
//       server: SERVER_INFO.name
//     });

//   } catch (error) {
//     console.error('Multi-upload test error:', error);
//     res.status(500).json({ error: 'Multi-upload test failed' });
//   }
// });

// // Latency test with multiple measurements
// app.get('/api/latency', (req, res) => {
//   const measurements = [];
//   const count = parseInt(req.query.count) || 10;
//   const serverTime = Date.now();

//   for (let i = 0; i < count; i++) {
//     measurements.push({
//       id: i,
//       timestamp: serverTime + i,
//       server: SERVER_INFO.name
//     });
//   }

//   res.json({
//     measurements,
//     serverTime,
//     count,
//     server: SERVER_INFO.name
//   });
// });

// // Jitter test endpoint
// app.get('/api/jitter', (req, res) => {
//   const count = parseInt(req.query.count) || 20;
//   const measurements = [];

//   let currentCount = 0;
//   const interval = setInterval(() => {
//     if (currentCount >= count) {
//       clearInterval(interval);
//       res.json({
//         measurements,
//         count,
//         server: SERVER_INFO.name
//       });
//       return;
//     }

//     measurements.push({
//       id: currentCount,
//       timestamp: Date.now(),
//       server: SERVER_INFO.name
//     });

//     currentCount++;
//   }, 100 + Math.random() * 50); // Random interval between 100-150ms
// });

// // Warm-up endpoint for TCP connection optimization
// app.get('/api/warmup', (req, res) => {
//   const warmupData = generateTestData(1); // 1MB warmup

//   res.setHeader('Content-Type', 'application/octet-stream');
//   res.setHeader('Content-Length', warmupData.length.toString());
//   res.setHeader('Cache-Control', 'no-cache');
//   res.setHeader('X-Warmup', 'true');

//   res.send(warmupData);
// });

// // WebSocket-like endpoint for real-time monitoring
// app.get('/api/realtime-monitor', (req, res) => {
//   res.setHeader('Content-Type', 'text/event-stream');
//   res.setHeader('Cache-Control', 'no-cache');
//   res.setHeader('Connection', 'keep-alive');
//   res.setHeader('Access-Control-Allow-Origin', '*');

//   let counter = 0;
//   const interval = setInterval(() => {
//     if (counter >= 30) { // 30 seconds of monitoring
//       clearInterval(interval);
//       res.write('data: {"type": "complete"}\n\n');
//       res.end();
//       return;
//     }

//     const data = {
//       type: 'monitor',
//       timestamp: Date.now(),
//       counter,
//       memory: process.memoryUsage(),
//       uptime: process.uptime()
//     };

//     res.write(`data: ${JSON.stringify(data)}\n\n`);
//     counter++;
//   }, 1000);

//   req.on('close', () => {
//     clearInterval(interval);
//   });
// });

// // Error handling middleware
// app.use((error, req, res, next) => {
//   console.error('Server error:', error);
//   res.status(500).json({
//     error: 'Internal server error',
//     message: error.message
//   });
// });

// // 404 handler
// app.use((req, res) => {
//   res.status(404).json({ error: 'Endpoint not found' });
// });

// // Start server with optimized settings
// const server = app.listen(PORT, () => {
//   console.log(`Improved Speed Test Server running on port ${PORT}`);
//   console.log(`Server Info:`, SERVER_INFO);
//   console.log(`Available endpoints:`);
//   console.log(`  GET  /api/ping - Basic ping test`);
//   console.log(`  GET  /api/info - Server information`);
//   console.log(`  GET  /api/servers - Available servers`);
//   console.log(`  GET  /api/download/:size - Download test (1-200 MB)`);
//   console.log(`  GET  /api/download-multi/:size/:connections - Multi-connection download`);
//   console.log(`  GET  /api/download-progressive - Progressive download test`);
//   console.log(`  POST /api/upload - Upload test`);
//   console.log(`  POST /api/upload-multi - Multi-connection upload`);
//   console.log(`  GET  /api/latency - Latency test`);
//   console.log(`  GET  /api/jitter - Jitter test`);
//   console.log(`  GET  /api/warmup - TCP warmup`);
//   console.log(`  GET  /api/realtime-monitor - Real-time monitoring`);
// });

// // Optimize server settings
// server.keepAliveTimeout = 65000;
// server.headersTimeout = 66000;

// module.exports = app;

// const express = require('express');
// const cors = require('cors');
// const multer = require('multer');
// const crypto = require('crypto');
// const os = require('os');
// const app = express();

// // Middleware
// app.use(cors());
// app.use(express.json({ limit: '50mb' }));
// app.use(express.raw({ limit: '50mb', type: 'application/octet-stream' }));

// // Configure multer for file uploads
// const upload = multer({
//   limits: {
//     fileSize: 100 * 1024 * 1024, // 100MB limit
//   },
//   storage: multer.memoryStorage()
// });

// // Server configuration
// const PORT = process.env.PORT || 3001;
// const SERVER_INFO = {
//   name: 'Speed Test Server',
//   location: 'Auto-detected',
//   host: os.hostname(),
//   platform: os.platform(),
//   arch: os.arch()
// };

// // Generate test data of specific size
// const generateTestData = (sizeInMB) => {
//   const sizeInBytes = sizeInMB * 1024 * 1024;
//   return crypto.randomBytes(sizeInBytes);
// };

// // Routes

// // Health check / Ping endpoint
// app.get('/api/ping', (req, res) => {
//   const timestamp = Date.now();
//   res.json({
//     timestamp,
//     server: SERVER_INFO.name,
//     pong: 'pong'
//   });
// });

// // Get server information
// app.get('/api/info', (req, res) => {
//   res.json({
//     server: SERVER_INFO,
//     timestamp: Date.now(),
//     uptime: process.uptime(),
//     memory: process.memoryUsage(),
//     network: {
//       interfaces: Object.keys(os.networkInterfaces())
//     }
//   });
// });

// // Get available test servers (for now just this one)
// app.get('/api/servers', (req, res) => {
//   res.json([
//     {
//       id: 1,
//       name: SERVER_INFO.name,
//       location: SERVER_INFO.location,
//       host: req.get('host'),
//       distance: 0, // Local server
//       ping: null
//     }
//   ]);
// });

// // Download speed test endpoints
// app.get('/api/download/:size', (req, res) => {
//   const size = parseInt(req.params.size);

//   // Validate size (1MB to 100MB)
//   if (isNaN(size) || size < 1 || size > 100) {
//     return res.status(400).json({ error: 'Invalid size. Must be between 1 and 100 MB' });
//   }

//   try {
//     // Set headers for proper speed testing
//     res.setHeader('Content-Type', 'application/octet-stream');
//     res.setHeader('Content-Length', size * 1024 * 1024);
//     res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
//     res.setHeader('Pragma', 'no-cache');
//     res.setHeader('Expires', '0');

//     // Add timestamp for uniqueness
//     res.setHeader('X-Timestamp', Date.now().toString());

//     // Generate and send test data
//     const testData = generateTestData(size);
//     res.send(testData);

//   } catch (error) {
//     console.error('Download test error:', error);
//     res.status(500).json({ error: 'Failed to generate test data' });
//   }
// });

// // Upload speed test endpoint
// app.post('/api/upload', upload.single('testfile'), (req, res) => {
//   const startTime = Date.now();

//   try {
//     let dataSize = 0;

//     // Check if file was uploaded via multer
//     if (req.file) {
//       dataSize = req.file.size;
//     }
//     // Check if raw data was sent
//     else if (req.body && Buffer.isBuffer(req.body)) {
//       dataSize = req.body.length;
//     }
//     // Check if JSON data was sent
//     else if (req.body && req.body.data) {
//       dataSize = Buffer.byteLength(JSON.stringify(req.body.data));
//     }
//     else {
//       return res.status(400).json({ error: 'No data received' });
//     }

//     const endTime = Date.now();
//     const duration = endTime - startTime;

//     res.json({
//       success: true,
//       dataSize,
//       duration,
//       timestamp: endTime,
//       server: SERVER_INFO.name
//     });

//   } catch (error) {
//     console.error('Upload test error:', error);
//     res.status(500).json({ error: 'Upload test failed' });
//   }
// });

// // Bulk upload endpoint for multiple chunks
// app.post('/api/upload-chunk', (req, res) => {
//   const startTime = Date.now();

//   try {
//     const { chunkData, chunkSize, chunkIndex } = req.body;

//     if (!chunkData || !chunkSize) {
//       return res.status(400).json({ error: 'Invalid chunk data' });
//     }

//     const endTime = Date.now();
//     const duration = endTime - startTime;

//     res.json({
//       success: true,
//       chunkIndex: chunkIndex || 0,
//       chunkSize,
//       duration,
//       timestamp: endTime
//     });

//   } catch (error) {
//     console.error('Chunk upload error:', error);
//     res.status(500).json({ error: 'Chunk upload failed' });
//   }
// });

// // Latency test endpoint - returns immediately
// app.get('/api/latency', (req, res) => {
//   res.json({
//     timestamp: Date.now(),
//     server: SERVER_INFO.name
//   });
// });

// // Multiple ping test endpoint
// app.get('/api/multi-ping', (req, res) => {
//   const count = parseInt(req.query.count) || 10;
//   const pings = [];

//   for (let i = 0; i < count; i++) {
//     pings.push({
//       id: i,
//       timestamp: Date.now(),
//       server: SERVER_INFO.name
//     });
//   }

//   res.json({
//     pings,
//     count,
//     server: SERVER_INFO.name
//   });
// });

// // WebSocket-like endpoint for real-time ping
// app.get('/api/realtime-ping', (req, res) => {
//   res.setHeader('Content-Type', 'text/plain');
//   res.setHeader('Cache-Control', 'no-cache');
//   res.setHeader('Connection', 'keep-alive');

//   let counter = 0;
//   const interval = setInterval(() => {
//     if (counter >= 10) {
//       clearInterval(interval);
//       res.end();
//       return;
//     }

//     res.write(`ping-${counter}-${Date.now()}\n`);
//     counter++;
//   }, 100);

//   // Clean up on client disconnect
//   req.on('close', () => {
//     clearInterval(interval);
//   });
// });

// // Error handling middleware
// app.use((error, req, res, next) => {
//   console.error('Server error:', error);
//   res.status(500).json({
//     error: 'Internal server error',
//     message: error.message
//   });
// });

// // 404 handler
// app.use((req, res) => {
//   res.status(404).json({ error: 'Endpoint not found' });
// });

// // Start server
// app.listen(PORT, () => {
//   console.log(`Speed Test Server running on port ${PORT}`);
//   console.log(`Server Info:`, SERVER_INFO);
//   console.log(`Available endpoints:`);
//   console.log(`  GET  /api/ping - Basic ping test`);
//   console.log(`  GET  /api/info - Server information`);
//   console.log(`  GET  /api/servers - Available servers`);
//   console.log(`  GET  /api/download/:size - Download test (1-100 MB)`);
//   console.log(`  POST /api/upload - Upload test`);
//   console.log(`  GET  /api/latency - Latency test`);
//   console.log(`  GET  /api/multi-ping - Multiple ping test`);
//   console.log(`  GET  /api/realtime-ping - Real-time ping stream`);
// });

// module.exports = app;
