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

const SIGNALING_URL = "wss://inai-col3.fishrungames.com/signaling/";

function App() {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const clientIdRef = useRef(Math.random().toString(36).slice(2, 10));
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("Connecting...");

  const sendMessage = (message: object) => {
    const socket = socketRef.current;

    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      streamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      setCameraOn(true);
      setMicOn(true);

      return stream;
    } catch (error) {
      console.error("Camera error:", error);
      setStatus("Camera access denied");
      return null;
    }
  };

  const createPeerConnection = () => {
    if (peerRef.current) {
      return peerRef.current;
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });

    peerRef.current = pc;

    const stream = streamRef.current;

    if (stream) {
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendMessage({
          type: "ice-candidate",
          candidate: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }

      setConnected(true);
      setStatus("Connected");
    };

    pc.onconnectionstatechange = () => {
      console.log("WebRTC state:", pc.connectionState);

      if (pc.connectionState === "connected") {
        setConnected(true);
        setStatus("Connected");
      }

      if (
        pc.connectionState === "disconnected" ||
        pc.connectionState === "failed"
      ) {
        setConnected(false);
        setStatus("Connection interrupted");
      }
      if (pc.connectionState === "closed") {
        setConnected(false);
      }
    };

    return pc;
  };

  const createOffer = async () => {
    const pc = createPeerConnection();

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      sendMessage({
        type: "offer",
        offer,
      });
    } catch (error) {
      console.error("Offer error:", error);
    }
  };

  const handleOffer = async (offer: RTCSessionDescriptionInit) => {
    const pc = createPeerConnection();

    try {
      await pc.setRemoteDescription(
        new RTCSessionDescription(offer)
      );

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      sendMessage({
        type: "answer",
        answer,
      });

      await processPendingCandidates();
    } catch (error) {
      console.error("Answer error:", error);
    }
  };

  const handleAnswer = async (answer: RTCSessionDescriptionInit) => {
    const pc = peerRef.current;

    if (!pc) return;

    try {
      await pc.setRemoteDescription(
        new RTCSessionDescription(answer)
      );

      await processPendingCandidates();
    } catch (error) {
      console.error("Set answer error:", error);
    }
  };

  const handleCandidate = async (
    candidate: RTCIceCandidateInit
  ) => {
    const pc = peerRef.current;

    if (!pc || !pc.remoteDescription) {
      pendingCandidatesRef.current.push(candidate);
      return;
    }

    try {
      await pc.addIceCandidate(
        new RTCIceCandidate(candidate)
      );
    } catch (error) {
      console.error("ICE candidate error:", error);
    }
  };

  const processPendingCandidates = async () => {
    const pc = peerRef.current;

    if (!pc || !pc.remoteDescription) return;

    const candidates = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];

    for (const candidate of candidates) {
      try {
        await pc.addIceCandidate(
          new RTCIceCandidate(candidate)
        );
      } catch (error) {
        console.error("Pending ICE error:", error);
      }
    }
  };

  const connectSignaling = () => {
    const socket = new WebSocket(SIGNALING_URL);
    socketRef.current = socket;

    socket.onopen = () => {
      setStatus("Waiting for participant...");

      sendMessage({
        type: "ready",
        clientId: clientIdRef.current,
      });
    };

    socket.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);

        console.log("Received:", message);

        if (message.type === "peer-left") {
          peerRef.current?.close();
          peerRef.current = null;

          pendingCandidatesRef.current = [];

          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = null;
          }

          setConnected(false);
          setStatus("Participant left");
          return;
        }

        if (message.type === "ready") {
          if (!message.clientId) return;

          // Только один участник создаёт offer.
          if (clientIdRef.current > message.clientId) {
            await createOffer();
          }

          setStatus("Participant found");
          return;
        }

        if (message.type === "offer") {
          await handleOffer(message.offer);
          return;
        }

        if (message.type === "answer") {
          await handleAnswer(message.answer);
          return;
        }

        if (message.type === "ice-candidate") {
          if (message.candidate) {
            await handleCandidate(message.candidate);
          }
        }
      } catch (error) {
        console.error("WebSocket message error:", error);
      }
    };

    socket.onerror = (error) => {
      console.error("WebSocket error:", error);
      setStatus("Signaling server error");
    };

    socket.onclose = () => {
      setStatus("Disconnected from server");
    };
  };

  useEffect(() => {
    const initialize = async () => {
      await startCamera();
      connectSignaling();
    };

    void initialize();

    return () => {
      peerRef.current?.close();
      socketRef.current?.close();

      streamRef.current?.getTracks().forEach((track) => {
        track.stop();
      });
    };
  }, []);

  const toggleCamera = () => {
    const stream = streamRef.current;

    if (!stream) return;

    const nextState = !cameraOn;

    stream.getVideoTracks().forEach((track) => {
      track.enabled = nextState;
    });

    setCameraOn(nextState);
  };

  const toggleMicrophone = () => {
    const stream = streamRef.current;

    if (!stream) return;

    const nextState = !micOn;

    stream.getAudioTracks().forEach((track) => {
      track.enabled = nextState;
    });

    setMicOn(nextState);
  };

  const leaveCall = () => {
    peerRef.current?.close();
    peerRef.current = null;

    socketRef.current?.close();
    socketRef.current = null;

    streamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });

    streamRef.current = null;

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    setCameraOn(false);
    setMicOn(false);
    setConnected(false);
    setStatus("Call ended");
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
            <video
              ref={remoteVideoRef}
              className="video-element"
              autoPlay
              playsInline
            />

            {!connected && (
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
            )}

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
            >
              {micOn ? <Mic size={21} /> : <MicOff size={21} />}
              <span>Microphone</span>
            </button>

            <button
              className={`control-button ${cameraOn ? "" : "control-off"}`}
              onClick={toggleCamera}
            >
              {cameraOn ? <Video size={21} /> : <VideoOff size={21} />}
              <span>Camera</span>
            </button>

            <button className="control-button" disabled>
              <MonitorUp size={21} />
              <span>Share screen</span>
            </button>

            <button
              className="control-button leave-button"
              onClick={leaveCall}
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