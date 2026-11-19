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
  const localStreamRef = useRef<MediaStream | null>(null);

  const remoteStreamRef = useRef<MediaStream>(new MediaStream());

  const makingOfferRef = useRef(false);
  const ignoreOfferRef = useRef(false);
  const politeRef = useRef(false);

  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

 

  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("Starting camera...");

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

      localStreamRef.current = stream;

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

  const processPendingCandidates = async () => {
    const pc = peerRef.current;

    if (!pc?.remoteDescription) return;

    const candidates = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];

    for (const candidate of candidates) {
      try {
        await pc.addIceCandidate(
          new RTCIceCandidate(candidate)
        );
      } catch (error) {
        console.error("ICE candidate error:", error);
      }
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

    const localStream = localStreamRef.current;

    if (localStream) {
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
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
      const remoteStream = remoteStreamRef.current;

      if (
        !remoteStream
          .getTracks()
          .some((track) => track.id === event.track.id)
      ) {
        remoteStream.addTrack(event.track);
      }

      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
      }

      setConnected(true);
      setStatus("Connected");
    };

    pc.onnegotiationneeded = async () => {
      try {
        if (
          socketRef.current?.readyState !== WebSocket.OPEN
        ) {
          return;
        }

        makingOfferRef.current = true;

        await pc.setLocalDescription();

        sendMessage({
          type: "offer",
          offer: pc.localDescription,
        });

        console.log("Offer sent");
      } catch (error) {
        console.error("Negotiation error:", error);
      } finally {
        makingOfferRef.current = false;
      }
    };

    pc.onconnectionstatechange = () => {
      console.log("Connection state:", pc.connectionState);

      if (pc.connectionState === "connected") {
        setConnected(true);
        setStatus("Connected");
      } else if (pc.connectionState === "connecting") {
        setStatus("Connecting...");
      } else if (pc.connectionState === "disconnected") {
        setConnected(false);
        setStatus("Connection interrupted");
      } else if (pc.connectionState === "failed") {
        setConnected(false);
        setStatus("Connection failed");
      } else if (pc.connectionState === "closed") {
        setConnected(false);
        setStatus("Connection closed");
      }
    };

    return pc;
  };

  const handleOffer = async (
    offer: RTCSessionDescriptionInit
  ) => {
    try {
      const pc = createPeerConnection();

      const offerCollision =
        makingOfferRef.current ||
        pc.signalingState !== "stable";

      ignoreOfferRef.current =
        !politeRef.current && offerCollision;

      if (ignoreOfferRef.current) {
        console.log("Offer ignored");
        return;
      }

      if (offerCollision && politeRef.current) {
        await pc.setLocalDescription({
          type: "rollback",
        });
      }

      await pc.setRemoteDescription(
        new RTCSessionDescription(offer)
      );

      await processPendingCandidates();

      const answer = await pc.createAnswer();

      await pc.setLocalDescription(answer);

      sendMessage({
        type: "answer",
        answer: pc.localDescription,
      });

      console.log("Answer sent");
      setStatus("Connecting...");
    } catch (error) {
      console.error("Offer error:", error);
    }
  };

  const handleAnswer = async (
    answer: RTCSessionDescriptionInit
  ) => {
    try {
      const pc = peerRef.current;

      if (!pc) return;

      await pc.setRemoteDescription(
        new RTCSessionDescription(answer)
      );

      await processPendingCandidates();

      console.log("Answer received");
    } catch (error) {
      console.error("Answer error:", error);
    }
  };

  const handleCandidate = async (
    candidate: RTCIceCandidateInit
  ) => {
    const pc = peerRef.current;

    if (!pc?.remoteDescription) {
      pendingCandidatesRef.current.push(candidate);
      return;
    }

    try {
      await pc.addIceCandidate(
        new RTCIceCandidate(candidate)
      );
    } catch (error) {
      if (!ignoreOfferRef.current) {
        console.error("ICE error:", error);
      }
    }
  };

  const connectSignaling = () => {
    const socket = new WebSocket(SIGNALING_URL);
    socketRef.current = socket;

    socket.onopen = () => {
      console.log("WebSocket connected");
      setStatus("Negotiating connection...");

      // После подключения запускаем WebRTC переговоры
      const pc = peerRef.current;

      if (pc && pc.signalingState === "stable") {
        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => {
            sendMessage({
              type: "offer",
              offer: pc.localDescription,
            });

            console.log("Initial offer sent");
          })
          .catch((error) => {
            console.error("Initial offer error:", error);
          });
      }
    };

    socket.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);

        console.log("Message received:", message);

        if (message.type === "peer-left") {
          peerRef.current?.close();
          peerRef.current = null;

          pendingCandidatesRef.current = [];
          remoteStreamRef.current = new MediaStream();

          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = null;
          }

          setConnected(false);
          setStatus("Participant left");
          return;
        }

        if (message.type === "offer") {
          const offer = message.offer ?? message.description;

          if (offer) {
            await handleOffer(offer);
          }

          return;
        }

        if (message.type === "answer") {
          const answer = message.answer ?? message.description;

          if (answer) {
            await handleAnswer(answer);
          }

          return;
        }

        if (
          message.type === "ice-candidate" ||
          message.type === "candidate"
        ) {
          if (message.candidate) {
            await handleCandidate(message.candidate);
          }
        }
      } catch (error) {
        console.error("Message error:", error);
      }
    };

    socket.onerror = (error) => {
      console.error("WebSocket error:", error);
      setStatus("Signaling server error");
    };

    socket.onclose = () => {
      console.log("WebSocket disconnected");
      setStatus("Signaling disconnected");
    };
  };

  useEffect(() => {
    const initialize = async () => {
      const stream = await startCamera();

      if (!stream) return;

      // Создаём PeerConnection до подключения WebSocket
      createPeerConnection();

      connectSignaling();
    };

    initialize();

    return () => {
      peerRef.current?.close();
      socketRef.current?.close();

      localStreamRef.current?.getTracks().forEach((track) => {
        track.stop();
      });
    };
  }, []);

  const toggleCamera = () => {
    const stream = localStreamRef.current;

    if (!stream) return;

    const nextState = !cameraOn;

    stream.getVideoTracks().forEach((track) => {
      track.enabled = nextState;
    });

    setCameraOn(nextState);
  };

  const toggleMicrophone = () => {
    const stream = localStreamRef.current;

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

    localStreamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });

    localStreamRef.current = null;
    remoteStreamRef.current = new MediaStream();

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
                  {status}
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