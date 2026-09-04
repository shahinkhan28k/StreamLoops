import express from "express";
import path from "path";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import { initializeApp, getApps, App } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

// Initialize Firebase Admin
let firebaseApp: App;
if (getApps().length === 0) {
  firebaseApp = initializeApp({
    projectId: "lucky-rookery-d3bk6",
    storageBucket: "lucky-rookery-d3bk6.firebasestorage.app"
  });
} else {
  firebaseApp = getApps()[0] as App;
}

const db = getFirestore(firebaseApp, "ai-studio-streamloop247-1977a596-79bc-4af1-b3e2-b74b9bc7a330");
const bucket = getStorage(firebaseApp).bucket();
const app = express();
const PORT = 3000;

// Storage configuration for Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + file.originalname);
  },
});

const upload = multer({ storage });

app.use(express.json());

let currentStream: any = null;
let streamLogs: string[] = [];

const addLog = (msg: string) => {
  const timestamp = new Date().toLocaleTimeString();
  const log = `[${timestamp}] ${msg}`;
  streamLogs.push(log);
  if (streamLogs.length > 100) streamLogs.shift();
  console.log(log);
};

// API: Get uploaded videos
app.get("/api/videos", async (req, res) => {
  const userId = req.query.userId as string;
  try {
    if (userId) {
      const snapshot = await db.collection("videos").where("userId", "==", userId).get();
      const videos = snapshot.docs.map(doc => doc.data());
      // If we have firestore records, return them
      if (videos.length > 0) return res.json(videos);
    }

    const uploadPath = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(uploadPath)) {
      return res.json([]);
    }
    const files = fs.readdirSync(uploadPath);
    const videoFiles = files.filter(f => /\.(mp4|mkv|avi|mov)$/i.test(f));
    res.json(videoFiles.map(f => ({ name: f, path: f })));
  } catch (error) {
    res.status(500).json({ error: "Failed to list videos" });
  }
});

// API: Upload video to Firebase Storage
app.post("/api/upload", upload.single("video"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const userId = req.body.userId;
  const fileName = `${Date.now()}-${req.file.originalname}`;
  const filePath = req.file.path;

  try {
    // Upload to Firebase Storage
    const [file] = await bucket.upload(filePath, {
      destination: `videos/${userId || "anonymous"}/${fileName}`,
      metadata: {
        contentType: req.file.mimetype,
      },
    });

    // Make the file public (optional, but good for preview)
    await file.makePublic();
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${file.name}`;

    if (userId) {
      await db.collection("videos").add({
        userId,
        name: req.file.originalname,
        path: fileName,
        url: publicUrl,
        storagePath: file.name,
        uploadedAt: FieldValue.serverTimestamp()
      });
    }

    // Keep local file for immediate streaming (optional)
    // or we can just send the filename
    res.json({ 
      message: "File uploaded to Cloud Storage", 
      filename: fileName,
      url: publicUrl 
    });
  } catch (error) {
    console.error("Cloud Storage Upload Failed:", error);
    res.status(500).json({ error: "Failed to upload to Cloud Storage" });
  } finally {
    // Optional: Clean up local file after cloud upload if you want to save server space
    // fs.unlinkSync(filePath);
  }
});

// API: Start Stream
app.post("/api/stream/start", async (req, res) => {
  const { rtmpUrl, videoPath, loop = true, userId, title, platform } = req.body;

  if (!rtmpUrl || !videoPath) {
    return res.status(400).json({ error: "Missing RTMP URL or video path" });
  }

  if (currentStream) {
    return res.status(400).json({ error: "A stream is already running" });
  }

  const localVideoPath = path.join(process.cwd(), "uploads", videoPath);
  let finalPath = localVideoPath;

  // If local file doesn't exist, try to download from cloud if we have a record
  if (!fs.existsSync(localVideoPath)) {
    try {
      const snapshot = await db.collection("videos").where("path", "==", videoPath).limit(1).get();
      if (!snapshot.empty) {
        const videoData = snapshot.docs[0].data();
        if (videoData.storagePath) {
          addLog(`Downloading ${videoPath} from Cloud Storage...`);
          await bucket.file(videoData.storagePath).download({ destination: localVideoPath });
          addLog("Download complete.");
        }
      }
    } catch (err) {
      console.error("Cloud sync failed:", err);
    }
  }
  
  if (!fs.existsSync(finalPath)) {
    return res.status(404).json({ error: "Video file not found locally or in cloud" });
  }

  addLog(`Starting stream for ${videoPath} (Loop: ${loop})...`);

  try {
    const inputOptions = ["-re"];
    if (loop) {
      inputOptions.push("-stream_loop -1");
    }

    currentStream = ffmpeg(finalPath)
      .inputOptions(inputOptions)
      .outputOptions([
        "-c:v libx264",
        "-preset veryfast",
        "-tune zerolatency",
        "-b:v 3000k",
        "-maxrate 3000k",
        "-bufsize 6000k",
        "-pix_fmt yuv420p",
        "-g 60",
        "-c:a aac",
        "-b:a 128k",
        "-ar 44100",
        "-f flv"
      ])
      .output(rtmpUrl)
      .on("start", async (commandLine) => {
        addLog("FFmpeg command: " + commandLine);
        addLog("Stream started successfully.");
        
        // Update Firestore
        if (userId) {
          await db.collection("streams").doc("active").set({
            userId,
            title: title || "Live Stream",
            platform: platform || "Custom",
            isStreaming: true,
            startedAt: FieldValue.serverTimestamp()
          });
        }
      })
      .on("stderr", (stderrLine) => {
        if (stderrLine.includes("Error") || stderrLine.includes("fatal")) {
           addLog("FFmpeg Error: " + stderrLine);
        }
      })
      .on("error", async (err) => {
        addLog("Stream Error: " + err.message);
        currentStream = null;
        await db.collection("streams").doc("active").delete().catch(() => {});
      })
      .on("end", async () => {
        addLog("Stream finished.");
        currentStream = null;
        await db.collection("streams").doc("active").delete().catch(() => {});
      });

    currentStream.run();
    res.json({ message: "Stream starting..." });
  } catch (error: any) {
    addLog("Failed to spawn FFmpeg: " + error.message);
    res.status(500).json({ error: "Failed to start stream" });
  }
});

// API: Stop Stream
app.post("/api/stream/stop", async (req, res) => {
  if (!currentStream) {
    return res.status(400).json({ error: "No stream is running" });
  }

  try {
    currentStream.kill("SIGKILL");
    currentStream = null;
    addLog("Stream stopped manually.");
    await db.collection("streams").doc("active").delete().catch(() => {});
    res.json({ message: "Stream stopped" });
  } catch (error) {
    res.status(500).json({ error: "Failed to stop stream" });
  }
});

// API: Stream Logs
app.get("/api/stream/logs", (req, res) => {
  res.json({ logs: streamLogs, isStreaming: !!currentStream });
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
