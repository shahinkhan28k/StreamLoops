import React, { useState, useEffect, useRef } from "react";
import { 
  Upload, Play, Square, Video, Terminal, AlertCircle, 
  CheckCircle2, Loader2, ChevronDown, Eye, EyeOff, X, 
  Home, Radio, PlaySquare, Settings, Share2, Info, LogOut, Mail, Lock, User, Trash2
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { auth, db } from "./lib/firebase";
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  onAuthStateChanged, 
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  User as FirebaseUser
} from "firebase/auth";
import { collection, query, where, onSnapshot, doc, getDoc, setDoc } from "firebase/firestore";
import { useAuthState } from "react-firebase-hooks/auth";

interface VideoFile {
  id: string | null;
  name: string;
  path: string;
  url?: string;
  storagePath?: string;
}

interface ActiveStream {
  userId: string;
  title: string;
  platform: string;
  isStreaming: boolean;
  startedAt: any;
}

type Tab = "home" | "stream" | "live" | "videos" | "settings";

const PLATFORMS = [
  { id: "youtube", name: "YouTube", icon: "🔴" },
  { id: "facebook", name: "Facebook", icon: "🔵" },
  { id: "twitch", name: "Twitch", icon: "🟣" },
  { id: "custom", name: "Custom RTMP", icon: "🌐" }
];

export default function App() {
  const [user, loadingAuth] = useAuthState(auth);
  const [activeTab, setActiveTab] = useState<Tab>("home");
  
  // Auth State
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLogin, setIsLogin] = useState(true);
  const [authError, setAuthError] = useState("");

  // Stream State
  const [rtmpServer, setRtmpServer] = useState(() => localStorage.getItem("rtmpServer") || "rtmp://a.rtmp.youtube.com/live2");
  const [streamKey, setStreamKey] = useState(() => localStorage.getItem("streamKey") || "");
  const [showStreamKey, setShowStreamKey] = useState(false);
  const [title, setTitle] = useState(() => localStorage.getItem("streamTitle") || "");
  const [description, setDescription] = useState(() => localStorage.getItem("streamDesc") || "");
  const [platform, setPlatform] = useState(() => localStorage.getItem("platform") || "youtube");
  const [isLooping, setIsLooping] = useState(true);
  
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [selectedVideo, setSelectedVideo] = useState(() => localStorage.getItem("selectedVideo") || "");
  const [logs, setLogs] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  
  const [activeStreams, setActiveStreams] = useState<ActiveStream[]>([]);
  
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchVideos();
    const interval = setInterval(fetchStatus, 2000);
    
    // Listen for active streams
    const q = query(collection(db, "streams"), where("isStreaming", "==", true));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const streams = snapshot.docs.map(doc => doc.data() as ActiveStream);
      setActiveStreams(streams);
    });

    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [user]);

  useEffect(() => {
    localStorage.setItem("rtmpServer", rtmpServer);
    localStorage.setItem("streamKey", streamKey);
    localStorage.setItem("streamTitle", title);
    localStorage.setItem("streamDesc", description);
    localStorage.setItem("selectedVideo", selectedVideo);
    localStorage.setItem("platform", platform);
  }, [rtmpServer, streamKey, title, description, selectedVideo, platform]);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const fetchVideos = async () => {
    try {
      const url = user ? `/api/videos?userId=${user.uid}` : "/api/videos";
      const res = await fetch(url);
      const data = await res.json();
      if (Array.isArray(data)) {
        setVideos(data);
      } else {
        setVideos([]);
      }
    } catch (error) {
      console.error("Failed to fetch videos", error);
      setVideos([]);
    }
  };

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/stream/logs");
      if (!res.ok) return; // Silent fail if server is not ready
      const data = await res.json();
      setLogs(data.logs || []);
      setIsStreaming(!!data.isStreaming);
    } catch (error) {
      // Ignore transient fetch errors to avoid UI noise
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith("video/")) {
      alert("Please upload a video file.");
      return;
    }
    setIsUploading(true);
    const formData = new FormData();
    formData.append("video", file);
    if (user) {
      formData.append("userId", user.uid);
    }
    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (res.ok) fetchVideos();
    } catch (error) {
      console.error("Upload failed", error);
    } finally {
      setIsUploading(false);
    }
  };

  const deleteVideo = async (videoId: string | null, videoPath: string) => {
    if (!confirm("Are you sure you want to delete this video? It will be removed from Cloud Storage as well.")) return;
    
    try {
      const res = await fetch(`/api/videos/${videoId}?path=${videoPath}`, {
        method: "DELETE",
      });
      if (res.ok) {
        fetchVideos();
        if (selectedVideo === videoPath) setSelectedVideo("");
      } else {
        const data = await res.json();
        alert(data.error || "Failed to delete video");
      }
    } catch (error) {
      console.error("Delete request failed", error);
    }
  };

  const startStream = async () => {
    if (!streamKey || !selectedVideo) {
      alert("Please provide a stream key and select a video.");
      return;
    }
    if (!user) {
      alert("Please login first to start a stream.");
      setActiveTab("settings");
      return;
    }

    try {
      const finalRtmpUrl = rtmpServer.endsWith('/') ? `${rtmpServer}${streamKey}` : `${rtmpServer}/${streamKey}`;
      const res = await fetch("/api/stream/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          rtmpUrl: finalRtmpUrl, 
          videoPath: selectedVideo, 
          loop: isLooping,
          userId: user.uid,
          title: title,
          platform: platform
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        alert(error.error);
      }
    } catch (error) {
      console.error("Failed to start stream", error);
    }
  };

  const stopStream = async () => {
    try {
      await fetch("/api/stream/stop", { method: "POST" });
    } catch (error) {
      console.error("Failed to stop stream", error);
    }
  };

  const handleGoogleLogin = async () => {
    setAuthError("");
    try {
      const provider = new GoogleAuthProvider();
      const cred = await signInWithPopup(auth, provider);
      await setDoc(doc(db, "users", cred.user.uid), {
        id: cred.user.uid,
        email: cred.user.email,
        createdAt: new Date()
      }, { merge: true });
    } catch (err: any) {
      setAuthError(err.message);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await setDoc(doc(db, "users", cred.user.uid), {
          id: cred.user.uid,
          email: email,
          createdAt: new Date()
        });
      }
    } catch (err: any) {
      setAuthError(err.message);
    }
  };

  const handleLogout = () => {
    signOut(auth);
  };

  if (loadingAuth) {
    return (
      <div className="min-h-screen bg-[#0a0a0c] flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-violet-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white font-sans selection:bg-violet-500/30 pb-24">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-violet-600/5 rounded-full blur-[140px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-blue-600/5 rounded-full blur-[140px]" />
      </div>

      <header className="px-6 py-8 flex items-center justify-between max-w-5xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-violet-600 rounded-xl flex items-center justify-center shadow-lg shadow-violet-600/20 cursor-pointer" onClick={() => setActiveTab("home")}>
            <Radio className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">StreamLoop</h1>
            <p className="text-xs text-gray-500 font-medium">Broadcast Hub v2.0</p>
          </div>
        </div>
        <div className="flex gap-2">
           <button className="p-2 hover:bg-white/5 rounded-full transition-colors text-gray-400">
             <Share2 className="w-5 h-5" />
           </button>
           <button onClick={() => setActiveTab("settings")} className="p-2 hover:bg-white/5 rounded-full transition-colors text-gray-400">
             <User className="w-5 h-5" />
           </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 space-y-8">
        <AnimatePresence mode="wait">
          {activeTab === "home" && (
            <motion.div key="home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-12">
              <section className="text-center py-12 space-y-6">
                <h2 className="text-5xl font-black tracking-tighter leading-tight">
                  Your 24/7 Broadcast <br/> <span className="text-violet-500">Empire Starts Here.</span>
                </h2>
                <p className="text-gray-400 max-w-xl mx-auto text-lg leading-relaxed">
                  StreamLoop is a powerful, self-hosted engine designed for creators who want 
                  to broadcast high-quality video content non-stop to platforms like YouTube, 
                  Twitch, and Facebook.
                </p>
                <div className="flex justify-center gap-4">
                  <button onClick={() => setActiveTab("stream")} className="px-8 py-4 bg-violet-600 rounded-2xl font-bold hover:bg-violet-500 transition-all shadow-lg shadow-violet-600/20">
                    Get Started
                  </button>
                  <button onClick={() => setActiveTab("live")} className="px-8 py-4 bg-white/5 rounded-2xl font-bold border border-white/10 hover:bg-white/10 transition-all">
                    View Live Now
                  </button>
                </div>
              </section>

              <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-[#141417] p-8 rounded-[32px] border border-white/5 space-y-4">
                  <div className="w-12 h-12 bg-blue-500/10 rounded-2xl flex items-center justify-center text-blue-400"><Radio/></div>
                  <h3 className="text-xl font-bold">Infinite Loop</h3>
                  <p className="text-sm text-gray-500">Seamlessly loop any video file indefinitely with hardware-accelerated encoding.</p>
                </div>
                <div className="bg-[#141417] p-8 rounded-[32px] border border-white/5 space-y-4">
                  <div className="w-12 h-12 bg-violet-500/10 rounded-2xl flex items-center justify-center text-violet-400"><Video/></div>
                  <h3 className="text-xl font-bold">Multi-Platform</h3>
                  <p className="text-sm text-gray-500">Broadcast to YouTube, Twitch, Facebook, or any custom RTMP server simultaneously.</p>
                </div>
                <div className="bg-[#141417] p-8 rounded-[32px] border border-white/5 space-y-4">
                  <div className="w-12 h-12 bg-green-500/10 rounded-2xl flex items-center justify-center text-green-400"><Lock/></div>
                  <h3 className="text-xl font-bold">Secure Vault</h3>
                  <p className="text-sm text-gray-500">Your stream keys and video library are securely managed and persisted under your account.</p>
                </div>
              </section>
            </motion.div>
          )}

          {activeTab === "stream" && (
            <motion.div key="stream" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-8">
              {!user ? (
                <div className="bg-[#141417] border border-white/5 rounded-[32px] p-12 text-center space-y-6">
                  <Lock className="w-12 h-12 text-violet-500 mx-auto" />
                  <h2 className="text-2xl font-bold">Login Required</h2>
                  <p className="text-gray-500 max-w-sm mx-auto">Please sign in to your account to configure and start your 24/7 stream.</p>
                  <button onClick={() => setActiveTab("settings")} className="px-8 py-3 bg-violet-600 rounded-xl font-bold">Go to Login</button>
                </div>
              ) : (
                <>
                  <section className="bg-[#141417] border border-white/5 rounded-[32px] p-8 shadow-2xl space-y-8">
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                        <div className="md:col-span-8 space-y-2">
                          <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Stream Title</label>
                          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="My 24/7 Live Show" className="w-full bg-[#1c1c1f] border border-white/5 rounded-2xl px-5 py-4 outline-none focus:border-violet-500/50 transition-all text-sm placeholder:text-gray-600" />
                        </div>
                        <div className="md:col-span-4 space-y-2">
                          <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Platform</label>
                          <div className="relative">
                            <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="w-full appearance-none bg-[#1c1c1f] border border-white/5 rounded-2xl px-5 py-4 outline-none focus:border-violet-500/50 transition-all text-sm cursor-pointer pr-12">
                              {PLATFORMS.map(p => <option key={p.id} value={p.id} className="bg-[#1c1c1f]">{p.icon} {p.name}</option>)}
                            </select>
                            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none w-4 h-4" />
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">RTMP Server URL</label>
                          <div className="relative group">
                            <input type="text" value={rtmpServer} onChange={(e) => setRtmpServer(e.target.value)} placeholder="rtmp://a.rtmp.youtube.com/live2" className="w-full bg-[#1c1c1f] border border-white/5 rounded-2xl px-5 py-4 outline-none focus:border-violet-500/50 transition-all text-sm placeholder:text-gray-600" />
                            <div className="absolute right-4 top-1/2 -translate-y-1/2 flex gap-2">
                              <button onClick={() => setRtmpServer("rtmp://a.rtmp.youtube.com/live2")} className="text-[10px] bg-white/5 hover:bg-white/10 px-2 py-1 rounded text-gray-400 font-bold uppercase transition-colors">YT</button>
                              <button onClick={() => setRtmpServer("rtmps://live-api-s.facebook.com:443/rtmp/")} className="text-[10px] bg-white/5 hover:bg-white/10 px-2 py-1 rounded text-gray-400 font-bold uppercase transition-colors">FB</button>
                            </div>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Stream Key</label>
                          <div className="relative group">
                            <input type={showStreamKey ? "text" : "password"} value={streamKey} onChange={(e) => setStreamKey(e.target.value)} placeholder="xxxx-xxxx-xxxx-xxxx" className="w-full bg-[#1c1c1f] border border-white/5 rounded-2xl px-5 py-4 outline-none focus:border-violet-500/50 transition-all text-sm pr-12 placeholder:text-gray-600" />
                            <button onClick={() => setShowStreamKey(!showStreamKey)} className="absolute right-4 top-1/2 -translate-y-1/2 p-2 hover:bg-white/5 rounded-lg transition-colors text-gray-400">{showStreamKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col md:flex-row gap-6 items-center">
                        <div className="w-full md:flex-1 space-y-2">
                          <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Select Video Content</label>
                          <div className="relative">
                            <select value={selectedVideo} onChange={(e) => setSelectedVideo(e.target.value)} className="w-full appearance-none bg-[#1c1c1f] border border-white/5 rounded-2xl px-5 py-4 outline-none focus:border-violet-500/50 transition-all text-sm cursor-pointer pr-12">
                              <option value="" disabled className="bg-[#1c1c1f]">Choose a file...</option>
                              {Array.isArray(videos) && videos.map((vid) => <option key={vid.name} value={vid.path} className="bg-[#1c1c1f]">📁 {vid.name}</option>)}
                            </select>
                            <Video className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none w-4 h-4" />
                          </div>
                        </div>
                        <div className="flex items-center gap-4 bg-[#1c1c1f] border border-white/5 p-4 rounded-2xl h-[58px] mt-6 md:mt-6">
                          <span className="text-xs font-bold text-gray-400 uppercase tracking-wide">Loop Video 24/7</span>
                          <button onClick={() => setIsLooping(!isLooping)} className={`relative w-12 h-6 rounded-full transition-colors duration-300 ${isLooping ? 'bg-violet-600' : 'bg-gray-700'}`}><motion.div animate={{ x: isLooping ? 26 : 4 }} className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-md" /></button>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <button onClick={startStream} disabled={isStreaming} className={`relative py-5 rounded-[20px] font-bold text-lg transition-all active:scale-95 flex items-center justify-center gap-2 ${isStreaming ? "bg-gray-800/50 text-gray-600 cursor-not-allowed border border-white/5" : "bg-violet-600 hover:bg-violet-500 text-white shadow-xl shadow-violet-600/20"}`}>{isStreaming ? <Loader2 className="w-6 h-6 animate-spin" /> : <Play className="w-5 h-5 fill-current" />}{isStreaming ? "Streaming Active" : "Start Live Stream"}</button>
                      <button onClick={stopStream} disabled={!isStreaming} className={`relative py-5 rounded-[20px] font-bold text-lg transition-all active:scale-95 flex items-center justify-center gap-2 ${!isStreaming ? "bg-gray-800/50 text-gray-600 cursor-not-allowed border border-white/5" : "bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20"}`}><Square className="w-5 h-5 fill-current" />Stop Broadcast</button>
                    </div>
                  </section>
                  <div className="bg-[#0f0f12] border border-white/5 rounded-[32px] overflow-hidden flex flex-col h-[300px] shadow-2xl">
                    <div className="bg-white/5 px-6 py-4 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Terminal className="w-4 h-4 text-violet-400" />
                        <span className="text-xs font-bold uppercase tracking-widest text-gray-500">Live Status Console</span>
                      </div>
                      {isStreaming && (
                        <div className="flex items-center gap-2 bg-green-500/10 px-3 py-1 rounded-full border border-green-500/20">
                          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                          <span className="text-[10px] font-black text-green-500 uppercase tracking-tighter">Live</span>
                        </div>
                      )}
                    </div>
                    <div ref={logContainerRef} className="flex-1 p-6 font-mono text-xs overflow-y-auto space-y-2 scrollbar-hide">
                      {logs.length === 0 && <p className="text-gray-700 italic">No logs available...</p>}
                      {logs.map((log, i) => <div key={i} className={`${log.includes("Error") ? "text-red-400" : log.includes("successfully") ? "text-violet-400" : "text-gray-400"}`}>{log}</div>)}
                    </div>
                  </div>
                </>
              )}
            </motion.div>
          )}

          {activeTab === "live" && (
            <motion.div key="live" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8">
              <div className="flex items-center justify-between">
                <h2 className="text-3xl font-black tracking-tight">Active Broadcasts</h2>
                <div className="px-4 py-1.5 bg-violet-600/10 border border-violet-500/20 rounded-full text-violet-400 text-xs font-bold">{activeStreams.length} Channels Live</div>
              </div>
              
              {activeStreams.length === 0 ? (
                <div className="bg-[#141417] border border-white/5 rounded-[32px] p-16 text-center space-y-6">
                  <div className="w-20 h-20 bg-white/5 rounded-[28px] flex items-center justify-center mx-auto"><Radio className="w-10 h-10 text-gray-700" /></div>
                  <div className="space-y-2">
                    <h3 className="text-2xl font-bold">No Active Streams</h3>
                    <p className="text-gray-500 max-w-xs mx-auto">There are no channels currently broadcasting. Be the first to go live!</p>
                  </div>
                  <button onClick={() => setActiveTab("stream")} className="px-10 py-4 bg-violet-600 rounded-2xl font-bold shadow-lg shadow-violet-600/20 hover:scale-105 transition-transform">Start Live Now</button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {activeStreams.map((s, i) => (
                    <div key={i} className="bg-[#141417] border border-white/5 rounded-[32px] p-6 flex items-center gap-6 group hover:border-violet-500/30 transition-colors">
                      <div className="w-24 h-24 bg-[#1c1c1f] rounded-2xl flex items-center justify-center overflow-hidden">
                        <div className="w-4 h-4 bg-red-500 rounded-full animate-ping" />
                      </div>
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-black uppercase tracking-widest text-violet-500">{s.platform}</span>
                          <span className="text-[10px] text-gray-600">•</span>
                          <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Active</span>
                        </div>
                        <h4 className="text-lg font-bold truncate">{s.title}</h4>
                        <p className="text-xs text-gray-500">Started {new Date(s.startedAt?.toDate()).toLocaleTimeString()}</p>
                      </div>
                      <button onClick={() => setActiveTab("stream")} className="p-4 bg-white/5 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity"><Play className="w-5 h-5 text-gray-400" /></button>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {activeTab === "videos" && (
            <motion.div key="videos" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8">
              <div className="flex items-center justify-between">
                <h2 className="text-3xl font-black tracking-tight">Your Library</h2>
                <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{videos.length} Files Uploaded</span>
              </div>

              <div 
                onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => { e.preventDefault(); setDragActive(false); e.dataTransfer.files[0] && handleFileUpload(e.dataTransfer.files[0]); }}
                className={`relative border-2 border-dashed rounded-[32px] p-12 text-center transition-all ${dragActive ? "border-violet-500 bg-violet-500/5" : "border-white/5 bg-[#141417] hover:border-white/10"}`}
              >
                <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" accept="video/*" onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])} />
                <div className={`w-16 h-16 rounded-[24px] mx-auto flex items-center justify-center mb-4 ${dragActive ? "bg-violet-500/20 text-violet-400" : "bg-[#1c1c1f] text-gray-600"}`}>
                  {isUploading ? <Loader2 className="w-8 h-8 animate-spin" /> : <Upload className="w-8 h-8" />}
                </div>
                <h3 className="text-xl font-bold">Upload New Content</h3>
                <p className="text-sm text-gray-500 mt-1">Drag and drop your video files here</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {Array.isArray(videos) && videos.map((vid, i) => (
                  <div key={i} className="bg-[#141417] border border-white/5 rounded-[28px] overflow-hidden group hover:border-violet-500/30 transition-colors">
                    <div className="h-40 bg-[#1c1c1f] flex items-center justify-center relative">
                      <Video className="w-12 h-12 text-gray-800" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <button onClick={() => { setSelectedVideo(vid.path); setActiveTab("stream"); }} className="p-4 bg-violet-600 rounded-full shadow-xl"><Play className="w-6 h-6 fill-current" /></button>
                      </div>
                    </div>
                    <div className="p-5 flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-sm truncate">{vid.name}</p>
                        <p className="text-[10px] text-gray-600 uppercase font-black tracking-widest mt-1">
                          {vid.id ? "Cloud Storage" : "Local Storage"}
                        </p>
                      </div>
                      <button 
                        onClick={() => deleteVideo(vid.id, vid.path)}
                        className="p-2 text-gray-700 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                        title="Delete video"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {activeTab === "settings" && (
            <motion.div key="settings" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="max-w-xl mx-auto space-y-8">
              {!user ? (
                <section className="bg-[#141417] border border-white/5 rounded-[40px] p-10 shadow-2xl space-y-8">
                  <div className="text-center space-y-2">
                    <div className="w-16 h-16 bg-violet-600/10 rounded-[24px] flex items-center justify-center mx-auto text-violet-500 mb-4"><Lock className="w-8 h-8" /></div>
                    <h2 className="text-3xl font-black tracking-tight">{isLogin ? "Welcome Back" : "Create Account"}</h2>
                    <p className="text-sm text-gray-500">{isLogin ? "Sign in to manage your 24/7 streams." : "Start your broadcasting journey today."}</p>
                  </div>
                  
                  <div className="space-y-4">
                    <button 
                      onClick={handleGoogleLogin}
                      className="w-full py-5 bg-white text-black rounded-[20px] font-bold text-lg flex items-center justify-center gap-3 hover:bg-gray-100 transition-all shadow-xl shadow-white/10"
                    >
                      <svg className="w-6 h-6" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                      </svg>
                      Sign in with Google
                    </button>

                    <div className="relative py-4">
                      <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/5"></div></div>
                      <div className="relative flex justify-center text-[10px] uppercase tracking-widest"><span className="bg-[#141417] px-4 text-gray-600 font-bold">Or use email address</span></div>
                    </div>

                    <form onSubmit={handleAuth} className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Email Address</label>
                        <div className="relative">
                          <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
                          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full bg-[#1c1c1f] border border-white/5 rounded-2xl px-12 py-4 outline-none focus:border-violet-500/50 transition-all text-sm" placeholder="alex@example.com" />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Secret Password</label>
                        <div className="relative">
                          <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
                          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full bg-[#1c1c1f] border border-white/5 rounded-2xl px-12 py-4 outline-none focus:border-violet-500/50 transition-all text-sm" placeholder="••••••••" />
                        </div>
                      </div>
                      {authError && (
                        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-500 space-y-2">
                          <div className="flex items-center gap-2"><AlertCircle className="w-4 h-4" />{authError}</div>
                          {authError.includes("operation-not-allowed") && (
                            <p className="text-[10px] text-gray-400 mt-1">Note: Email/Password login needs to be enabled in Firebase Console. Try Google Login above.</p>
                          )}
                        </div>
                      )}
                      <button type="submit" className="w-full py-5 bg-violet-600 rounded-[20px] font-bold text-lg hover:bg-violet-500 transition-all shadow-xl shadow-violet-600/20">{isLogin ? "Sign In Now" : "Create My Account"}</button>
                    </form>

                    <div className="text-center pt-4">
                      <button onClick={() => setIsLogin(!isLogin)} className="text-xs font-bold text-violet-500 uppercase tracking-widest hover:underline">{isLogin ? "Don't have an account? Sign Up" : "Already have an account? Login"}</button>
                    </div>
                  </div>
                </section>
              ) : (
                <section className="space-y-8">
                  <div className="bg-[#141417] border border-white/5 rounded-[40px] p-10 shadow-2xl text-center space-y-6">
                    <div className="w-24 h-24 bg-violet-600/10 rounded-[32px] flex items-center justify-center mx-auto relative">
                      <User className="w-12 h-12 text-violet-500" />
                      <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-green-500 border-4 border-[#141417] rounded-full" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-black tracking-tight">{user.email?.split('@')[0]}</h2>
                      <p className="text-sm text-gray-500 font-medium">{user.email}</p>
                    </div>
                    <div className="bg-[#1c1c1f] p-4 rounded-2xl border border-white/5 flex items-center justify-between text-left">
                      <div>
                        <p className="text-[10px] font-black text-gray-600 uppercase tracking-widest">Account ID</p>
                        <p className="text-xs font-mono text-gray-400 mt-1">{user.uid.substring(0, 16)}...</p>
                      </div>
                      <button onClick={() => { navigator.clipboard.writeText(user.uid); alert("ID Copied!"); }} className="p-3 bg-white/5 rounded-xl hover:bg-white/10 transition-colors"><X className="w-4 h-4 text-gray-500 rotate-45" /></button>
                    </div>
                    <button onClick={handleLogout} className="w-full py-4 bg-red-500/10 text-red-500 border border-red-500/20 rounded-2xl font-bold hover:bg-red-500/20 transition-all flex items-center justify-center gap-2"><LogOut className="w-5 h-5" /> Sign Out</button>
                  </div>

                  <div className="bg-[#141417] border border-white/5 rounded-[32px] p-8 space-y-6">
                    <h3 className="text-xl font-bold flex items-center gap-2"><Info className="w-5 h-5 text-gray-500" /> About StreamLoop</h3>
                    <div className="space-y-4 text-sm text-gray-400 leading-relaxed">
                      <p>StreamLoop is a cutting-edge 24/7 broadcasting platform designed for reliability and performance. Built with Node.js and FFmpeg, it allows you to maintain a permanent live presence without keeping your local computer running.</p>
                      <div className="pt-4 border-t border-white/5 space-y-2">
                        <div className="flex justify-between"><span className="text-gray-500">Version</span><span>2.0.4 Platinum</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">Engine</span><span>FFmpeg v4.4.2</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">Architecture</span><span>Full-Stack Express</span></div>
                      </div>
                    </div>
                  </div>
                </section>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-50 px-6 pb-6">
        <div className="max-w-md mx-auto bg-[#1a1a1c]/80 backdrop-blur-2xl border border-white/5 rounded-[28px] p-2 flex items-center justify-around shadow-2xl">
          {[
            { id: "home", icon: Home, label: "Home" },
            { id: "stream", icon: Radio, label: "Stream" },
            { id: "live", icon: Radio, label: "Live" },
            { id: "videos", icon: PlaySquare, label: "Videos" },
            { id: "settings", icon: Settings, label: "Settings" }
          ].map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id as Tab)} className={`relative flex flex-col items-center gap-1 px-4 py-2 rounded-2xl transition-all duration-300 ${activeTab === tab.id ? "text-violet-400" : "text-gray-500 hover:text-gray-400"}`}>
              {activeTab === tab.id && <motion.div layoutId="activeTab" className="absolute inset-0 bg-violet-500/10 rounded-2xl -z-10" transition={{ type: "spring", bounce: 0.2, duration: 0.6 }} />}
              <tab.icon className={`w-5 h-5 ${activeTab === tab.id ? 'stroke-[2.5px]' : ''}`} />
              <span className="text-[10px] font-bold uppercase tracking-widest">{tab.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
