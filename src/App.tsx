
import { useEffect, useRef, useState } from "react";
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  PhoneOff,
  Users,
  Settings,
  ShieldCheck,
  MonitorUp,
} from "lucide-react";
import "./App.css";

function App() {
  const localVideoRef = useRef<HTMLVideoElement>(null);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [status, setStatus] = useState("Waiting for connection");

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      setLocalStream(stream);
      setCameraOn(true);
      setMicOn(true);
      setStatus("Camera and microphone ready");
    } catch (error) {
      console.error("Camera access error:", error);
      setStatus("Camera access denied");
    }
  };

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  const toggleCamera = () => {
    if (!localStream) {
      void startCamera();
      return;
    }

    const nextState = !cameraOn;
    localStream.getVideoTracks().forEach((track) => {
      track.enabled = nextState;
    });
    setCameraOn(nextState);
  };

  const toggleMicrophone = () => {
    if (!localStream) {
      void startCamera();
      return;
    }

    const nextState = !micOn;
    localStream.getAudioTracks().forEach((track) => {
      track.enabled = nextState;
    });
    setMicOn(nextState);
  };

  const stopCamera = () => {
    localStream?.getTracks().forEach((track) => track.stop());

    setLocalStream(null);
    setCameraOn(false);
    setMicOn(false);
    setStatus("Camera stopped");
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">V</div>
          <span>VideoCall</span>
          <span className="brand-badge">BETA</span>
        </div>

        <div className="topbar-right">
          <div className="secure-label">
            <ShieldCheck size={17} />
            <span>Secure connection</span>
          </div>
          <button className="icon-button" aria-label="Settings">
            <Settings size={20} />
          </button>
        </div>
      </header>

      <main className="main-content">
        <section className="meeting-heading">
          <div>
            <div className="eyebrow">VIDEO CONFERENCE</div>
            <h1>Personal Meeting Room</h1>
            <p>Connect face to face, wherever you are.</p>
          </div>

          <div className="meeting-status">
            <span className="status-dot" />
            {status}
          </div>
        </section>

        <section className="video-grid">
          <div className="video-card local-card">
            <video
              ref={localVideoRef}
              className="video-element"
              autoPlay
              muted
              playsInline
            />

            {!cameraOn && (
              <div className="video-placeholder">
                <div className="avatar">You</div>
                <h3>Your camera is off</h3>
                <p>Turn on your camera to start</p>
              </div>
            )}

            <div className="video-label">
              <span className="video-indicator" />
              You
              <span className="you-badge">YOU</span>
            </div>

            {!micOn && (
              <div className="muted-indicator">
                <MicOff size={15} />
                Muted
              </div>
            )}
          </div>

          <div className="video-card remote-card">
            <div className="video-placeholder">
              <div className="avatar remote-avatar">
                <Users size={32} />
              </div>
              <h3>Waiting for participant</h3>
              <p>Your conversation partner will appear here</p>
              <span className="waiting-indicator">
                Waiting to connect...
              </span>
            </div>

            <div className="video-label">
              <span className="video-indicator waiting-dot" />
              Participant
            </div>
          </div>
        </section>

        <section className="meeting-controls">
          <div className="controls-info">
            <span className="controls-title">MEETING CONTROLS</span>
            <span className="controls-subtitle">
              Manage your audio and video
            </span>
          </div>

          <div className="control-buttons">
            <button
              className={`control-button ${micOn ? "" : "control-off"}`}
              onClick={toggleMicrophone}
              title="Toggle microphone"
            >
              {micOn ? <Mic size={21} /> : <MicOff size={21} />}
              <span>Microphone</span>
            </button>

            <button
              className={`control-button ${cameraOn ? "" : "control-off"}`}
              onClick={toggleCamera}
              title="Toggle camera"
            >
              {cameraOn ? <Video size={21} /> : <VideoOff size={21} />}
              <span>Camera</span>
            </button>

            <button
              className="control-button"
              title="Share screen"
              disabled
            >
              <MonitorUp size={21} />
              <span>Share screen</span>
            </button>

            <button
              className="control-button leave-button"
              onClick={stopCamera}
              title="Stop camera and microphone"
            >
              <PhoneOff size={21} />
              <span>Leave</span>
            </button>
          </div>
        </section>

        <footer className="page-footer">
          <ShieldCheck size={16} />
          <span>Your connection is private and secure.</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
