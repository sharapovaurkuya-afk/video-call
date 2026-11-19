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

  const wsRef = useRef<WebSocket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const clientIdRef = useRef(crypto.randomUUID());
  const peerIdRef = useRef<string | null>(null);
  const peerReadyRef = useRef(false);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [status, setStatus] = useState("Connecting...");
  const [connected, setConnected] = useState(false);

  const sendMessage = (message: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  };

  const createPeerConnection = () => {
    if (peerRef.current) return peerRef.current;

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendMessage({
          type: "ice-candidate",
          candidate: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      let stream = remoteStream;

      if (!stream) {
        stream = new MediaStream();
        setRemoteStream(stream);
      }

      stream.addTrack(event.track);

      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setStatus("Connected");
        setConnected(true);
      } else if (
        pc.connectionState === "disconnected" ||
        pc.connectionState === "failed"
      ) {
        setStatus("Connection lost");
        setConnected(false);
      }
    };

    peerRef.current = pc;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    return pc;
  };

  const makeOffer = async () => {
    const pc = createPeerConnection();

    if (!localStreamRef.current || !peerReadyRef.current) return;

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    sendMessage({
      type: "offer",
      offer,
    });
  };

  useEffect(() => {
    const ws = new WebSocket(SIGNALING_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("Waiting for participant");

      sendMessage({
        type: "ready",
        clientId: clientIdRef.current,
      });
    };

    ws.onmessage = async (event) => {
      const message = JSON.parse(event.data);

      if (message.type === "ready") {
        peerIdRef.current = message.clientId;
        peerReadyRef.current = true;
        setStatus("Participant found");

        if (
          localStreamRef.current &&
          clientIdRef.current < message.clientId
        ) {
          await makeOffer();
        }

        return;
      }

      if (message.type === "offer") {
        const pc = createPeerConnection();

        await pc.setRemoteDescription(
          new RTCSessionDescription(message.offer)
        );

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        sendMessage({
          type: "answer",
          answer,
        });

        return;
      }

      if (message.type === "answer") {
        const pc = peerRef.current;

        if (pc) {
          await pc.setRemoteDescription(
            new RTCSessionDescription(message.answer)
          );
        }

        return;
      }

      if (message.type === "ice-candidate") {
        const pc = peerRef.current;

        if (pc && message.candidate) {
          try {
            await pc.addIceCandidate(
              new RTCIceCandidate(message.candidate)
            );
          } catch (error) {
            console.error("ICE error:", error);
          }
        }

        return;
      }

      if (message.type === "peer-left") {
        peerReadyRef.current = false;
        peerIdRef.current = null;

        peerRef.current?.close();
        peerRef.current = null;

        setRemoteStream(null);
        setConnected(false);
        setStatus("Participant left");

        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = null;
        }
      }
    };

    ws.onerror = () => {
      setStatus("WebSocket error");
    };

    ws.onclose = () => {
      setStatus("Disconnected from server");
    };

    return () => {
      ws.close();
      peerRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      localStreamRef.current = stream;
      setLocalStream(stream);

      setCameraOn(true);
      setMicOn(true);

      const pc = createPeerConnection();

      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      setStatus("Camera and microphone ready");

      if (
        peerReadyRef.current &&
        clientIdRef.current < (peerIdRef.current || "")
      ) {
        await makeOffer();
      }
    } catch (error) {
      console.error(error);
      setStatus("Camera access denied");
    }
  };

  const toggleCamera = () => {
    if (!localStreamRef.current) {
      void startCamera();
      return;
    }

    const nextState = !cameraOn;

    localStreamRef.current.getVideoTracks().forEach((track) => {
      track.enabled = nextState;
    });

    setCameraOn(nextState);
  };

  const toggleMicrophone = () => {
    if (!localStreamRef.current) {
      void startCamera();
      return;
    }

    const nextState = !micOn;

    localStreamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = nextState;
    });

    setMicOn(nextState);
  };

  const stopCamera = () => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());

    localStreamRef.current = null;
    setLocalStream(null);
    setCameraOn(false);
    setMicOn(false);

    peerRef.current?.close();
    peerRef.current = null;

    setRemoteStream(null);
    setConnected(false);
    setStatus("Call ended");

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
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

            {!remoteStream && (
              <div className="video-placeholder">
                <div className="avatar remote-avatar">
                  <Users size={32} />
                </div>
                <h3>Waiting for participant</h3>
                <p>Your conversation partner will appear here</p>
                <span className="waiting-indicator">
                  {connected ? "Connected" : "Waiting to connect..."}
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

            <button className="control-button" title="Share screen" disabled>
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