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

  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const isInitiatorRef = useRef(false);

  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("Starting camera...");

  // Отправка сообщения через WebSocket
  const sendMessage = (message: object) => {
    const socket = socketRef.current;

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  };

  // Запуск камеры и микрофона
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

  // Создание WebRTC соединения
  const createPeerConnection = () => {
    if (peerRef.current) {
      return peerRef.current;
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        {
          urls: "stun:stun.l.google.com:19302",
        },
        {
          urls: "stun:stun1.l.google.com:19302",
        },
      ],
    });

    peerRef.current = pc;

    // Добавляем свою камеру и микрофон
    const localStream = localStreamRef.current;

    if (localStream) {
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });
    }

    // Отправляем ICE кандидаты
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendMessage({
          type: "candidate",
          candidate: event.candidate,
        });
      }
    };

    // Получаем видео и звук другого участника
    pc.ontrack = (event) => {
      console.log("Remote track received");

      const remoteStream = remoteStreamRef.current;

      if (!remoteStream
        .getTracks()
        .some((track) => track.id === event.track.id)) {
        remoteStream.addTrack(event.track);
      }

      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
      }

      setConnected(true);
      setStatus("Connected");
    };

    // Статус WebRTC
    pc.onconnectionstatechange = () => {
      console.log("Connection state:", pc.connectionState);

      switch (pc.connectionState) {
        case "connected":
          setConnected(true);
          setStatus("Connected");
          break;

        case "connecting":
          setStatus("Connecting to participant...");
          break;

        case "disconnected":
          setConnected(false);
          setStatus("Connection interrupted");
          break;

        case "failed":
          setConnected(false);
          setStatus("Connection failed");
          break;

        case "closed":
          setConnected(false);
          setStatus("Connection closed");
          break;
      }
    };

    return pc;
  };

  // Создание Offer
  const createOffer = async () => {
    try {
      const pc = createPeerConnection();

      const offer = await pc.createOffer();

      await pc.setLocalDescription(offer);

      sendMessage({
        type: "offer",
        description: pc.localDescription,
      });

      setStatus("Offer sent — waiting for answer");

      console.log("Offer sent");
    } catch (error) {
      console.error("Offer creation error:", error);
      setStatus("Offer error");
    }
  };

  // Получение Offer и отправка Answer
  const handleOffer = async (
    description: RTCSessionDescriptionInit
  ) => {
    try {
      const pc = createPeerConnection();

      await pc.setRemoteDescription(
        new RTCSessionDescription(description)
      );

      const answer = await pc.createAnswer();

      await pc.setLocalDescription(answer);

      sendMessage({
        type: "answer",
        description: pc.localDescription,
      });

      await processPendingCandidates();

      setStatus("Answer sent — connecting...");

      console.log("Answer sent");
    } catch (error) {
      console.error("Offer handling error:", error);
      setStatus("Answer error");
    }
  };

  // Получение Answer
  const handleAnswer = async (
    description: RTCSessionDescriptionInit
  ) => {
    try {
      const pc = peerRef.current;

      if (!pc) {
        console.error("Peer connection does not exist");
        return;
      }

      await pc.setRemoteDescription(
        new RTCSessionDescription(description)
      );

      await processPendingCandidates();

      console.log("Answer received");
    } catch (error) {
      console.error("Answer handling error:", error);
    }
  };

  // Получение ICE кандидата
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

      console.log("ICE candidate added");
    } catch (error) {
      console.error("ICE candidate error:", error);
    }
  };

  // Добавляем кандидатов, которые пришли раньше SDP
  const processPendingCandidates = async () => {
    const pc = peerRef.current;

    if (!pc || !pc.remoteDescription) {
      return;
    }

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

  // Подключение к signaling серверу
  const connectSignaling = () => {
    const socket = new WebSocket(SIGNALING_URL);

    socketRef.current = socket;

    socket.onopen = () => {
      console.log("WebSocket connected");

      setStatus("Waiting for participant...");

      // Сообщаем другому клиенту, что мы подключились
      sendMessage({
        type: "hello",
        clientId: clientIdRef.current,
      });
    };

    socket.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);

        console.log("Received signaling message:", message);

        // Другой участник вышел
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

        // Другой участник подключился
        if (message.type === "hello") {
          if (!message.clientId) {
            return;
          }

          setStatus("Participant found");

          // Определяем, кто создаёт Offer.
          // Только один участник должен его создавать.
          if (clientIdRef.current > message.clientId) {
            isInitiatorRef.current = true;

            await createOffer();
          }

          return;
        }

        // Получили Offer
        if (message.type === "offer") {
          const description =
            message.description ?? message.offer;

          if (description) {
            await handleOffer(description);
          }

          return;
        }

        // Получили Answer
        if (message.type === "answer") {
          const description =
            message.description ?? message.answer;

          if (description) {
            await handleAnswer(description);
          }

          return;
        }

        // Получили ICE candidate
        if (message.type === "candidate") {
          if (message.candidate) {
            await handleCandidate(message.candidate);
          }

          return;
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

      setStatus("Signaling disconnected");
    };
  };

  // Инициализация приложения
  useEffect(() => {
    const initialize = async () => {
      const stream = await startCamera();

      if (stream) {
        connectSignaling();
      }
    };

    void initialize();

    return () => {
      peerRef.current?.close();
      socketRef.current?.close();

      localStreamRef.current?.getTracks().forEach((track) => {
        track.stop();
      });
    };
  }, []);

  // Камера
  const toggleCamera = () => {
    const stream = localStreamRef.current;

    if (!stream) {
      return;
    }

    const nextState = !cameraOn;

    stream.getVideoTracks().forEach((track) => {
      track.enabled = nextState;
    });

    setCameraOn(nextState);
  };

  // Микрофон
  const toggleMicrophone = () => {
    const stream = localStreamRef.current;

    if (!stream) {
      return;
    }

    const nextState = !micOn;

    stream.getAudioTracks().forEach((track) => {
      track.enabled = nextState;
    });

    setMicOn(nextState);
  };

  // Завершение звонка
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
          {/* Local video */}
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

          {/* Remote video */}
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