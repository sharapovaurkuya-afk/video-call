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

  const clientIdRef = useRef(
    Math.random().toString(36).substring(2, 10)
  );

  const peerReadyRef = useRef(false);
  const offerCreatedRef = useRef(false);
  const helloIntervalRef = useRef<number | null>(null);
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

    pc.onconnectionstatechange = () => {
      console.log("WebRTC state:", pc.connectionState);

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

  const createOffer = async () => {
    try {
      const pc = createPeerConnection();

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      sendMessage({
        type: "offer",
        offer: pc.localDescription,
      });

      console.log("OFFER SENT");
      setStatus("Offer sent...");
    } catch (error) {
      console.error("Create offer error:", error);
      setStatus("Offer error");
    }
  };

  const handleOffer = async (
    offer: RTCSessionDescriptionInit
  ) => {
    try {
      const pc = createPeerConnection();

      await pc.setRemoteDescription(
        new RTCSessionDescription(offer)
      );

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      sendMessage({
        type: "answer",
        answer: pc.localDescription,
      });

      await processPendingCandidates();

      console.log("ANSWER SENT");
      setStatus("Connecting...");
    } catch (error) {
      console.error("Handle offer error:", error);
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

      console.log("ANSWER RECEIVED");
    } catch (error) {
      console.error("Handle answer error:", error);
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
      console.error("ICE error:", error);
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
        console.error("Pending ICE error:", error);
      }
    }
  };

  const sendReady = () => {
    sendMessage({
      type: "ready",
      clientId: clientIdRef.current,
    });

    console.log("READY SENT");
  };

  const connectSignaling = () => {
    const socket = new WebSocket(SIGNALING_URL);
    socketRef.current = socket;

    socket.onopen = () => {
      console.log("WebSocket connected");
      setStatus("Waiting for participant...");

      sendReady();

      // Повторяем READY, чтобы второй участник обнаружился,
      // даже если первое сообщение было отправлено слишком рано.
      helloIntervalRef.current = window.setInterval(() => {
        if (!peerReadyRef.current) {
          sendReady();
        }
      }, 1500);
    };

    socket.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);

        console.log("MESSAGE RECEIVED:", message);

        if (message.type === "peer-left") {
          peerReadyRef.current = false;
          offerCreatedRef.current = false;

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

        if (message.type === "ready") {
          if (!message.clientId) return;

          // Игнорируем собственное сообщение, если сервер
          // вдруг возвращает его отправителю
          if (message.clientId === clientIdRef.current) {
            return;
          }

          const wasReady = peerReadyRef.current;
          peerReadyRef.current = true;

          if (helloIntervalRef.current !== null) {
            clearInterval(helloIntervalRef.current);
            helloIntervalRef.current = null;
          }

          setStatus("Participant found");

          // Отвечаем READY один раз
          if (!wasReady) {
            sendReady();
          }

          // Только один из двух клиентов создаёт Offer
          if (
            clientIdRef.current > message.clientId &&
            !offerCreatedRef.current
          ) {
            offerCreatedRef.current = true;
            await createOffer();
          }

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
        console.error("Signaling message error:", error);
      }
    };

    socket.onerror = (error) => {
      console.error("WebSocket error:", error);
      setStatus("Signaling server error");
    };

    socket.onclose = () => {
      console.log("WebSocket disconnected");

      if (helloIntervalRef.current !== null) {
        clearInterval(helloIntervalRef.current);
        helloIntervalRef.current = null;
      }

      setStatus("Signaling disconnected");
    };
  };

  useEffect(() => {
    const initialize = async () => {
      const stream = await startCamera();

      if (stream) {
        connectSignaling();
      }
    };

    initialize();

    return () => {
      if (helloIntervalRef.current !== null) {
        clearInterval(helloIntervalRef.current);
      }

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

    if (helloIntervalRef.current !== null) {
      clearInterval(helloIntervalRef.current);
      helloIntervalRef.current = null;
    }

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