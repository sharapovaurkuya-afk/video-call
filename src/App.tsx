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

  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [status, setStatus] = useState("Connecting...");
  const [connected, setConnected] = useState(false);

  // WebRTC negotiation variables
  const makingOffer = useRef(false);
  const ignoreOffer = useRef(false);
  const polite = useRef(Math.random() > 0.5);

  // Connect to signaling server
  useEffect(() => {
    const socket = new WebSocket(SIGNALING_URL);
    socketRef.current = socket;

    const peerConnection = new RTCPeerConnection({
      iceServers: [
        {
          urls: "stun:stun.l.google.com:19302",
        },
      ],
    });

    peerConnectionRef.current = peerConnection;

    const remoteMediaStream = new MediaStream();
    setRemoteStream(remoteMediaStream);

    peerConnection.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach((track) => {
        remoteMediaStream.addTrack(track);
      });

      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteMediaStream;
      }

      setRemoteStream(new MediaStream(remoteMediaStream.getTracks()));
      setStatus("Participant connected");
    };

    // Send ICE candidates to the other participant
    peerConnection.onicecandidate = (event) => {
      if (event.candidate && socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            type: "candidate",
            candidate: event.candidate,
          }),
        );
      }
    };

    // Create offer when negotiation is needed
    peerConnection.onnegotiationneeded = async () => {
      try {
        makingOffer.current = true;

        await peerConnection.setLocalDescription();

        if (socket.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({
              type: peerConnection.localDescription?.type,
              description: peerConnection.localDescription,
            }),
          );
        }
      } catch (error) {
        console.error("Negotiation error:", error);
      } finally {
        makingOffer.current = false;
      }
    };

    peerConnection.onconnectionstatechange = () => {
      const connectionState = peerConnection.connectionState;

      if (connectionState === "connected") {
        setConnected(true);
        setStatus("Connected to participant");
      }

      if (connectionState === "disconnected") {
        setConnected(false);
        setStatus("Participant disconnected");
      }

      if (connectionState === "failed") {
        setConnected(false);
        setStatus("Connection failed");
      }
    };

    socket.onopen = () => {
      setStatus("Signaling connected — waiting for participant");
      console.log("Signaling WebSocket connected");
    };

    socket.onerror = (error) => {
      console.error("WebSocket error:", error);
      setStatus("Signaling server error");
    };

    socket.onclose = () => {
      setStatus("Signaling disconnected");
      console.log("Signaling WebSocket closed");
    };

    // Receive messages from signaling server
    socket.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);

        console.log("Signaling message:", message);

        if (message.type === "peer-left") {
          setConnected(false);
          setStatus("Participant left");

          remoteMediaStream.getTracks().forEach((track) => {
            remoteMediaStream.removeTrack(track);
          });

          setRemoteStream(null);

          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = null;
          }

          return;
        }

        // Handle offer / answer
        if (message.type === "offer" || message.type === "answer") {
          const description =
            message.description ??
            message.offer ??
            message.answer ??
            message.sdp;

          if (!description) {
            console.error("No SDP description in message");
            return;
          }

          const offerCollision =
            message.type === "offer" &&
            (makingOffer.current ||
              peerConnection.signalingState !== "stable");

          ignoreOffer.current = !polite.current && offerCollision;

          if (ignoreOffer.current) {
            console.log("Ignoring colliding offer");
            return;
          }

          await peerConnection.setRemoteDescription(description);

          if (message.type === "offer") {
            await peerConnection.setLocalDescription();

            socket.send(
              JSON.stringify({
                type: "answer",
                description: peerConnection.localDescription,
              }),
            );
          }
        }

        // Handle ICE candidate
        if (message.type === "candidate") {
          try {
            if (message.candidate) {
              await peerConnection.addIceCandidate(
                message.candidate,
              );
            }
          } catch (error) {
            if (!ignoreOffer.current) {
              console.error("ICE candidate error:", error);
            }
          }
        }
      } catch (error) {
        console.error("Message processing error:", error);
      }
    };

    return () => {
      socket.close();
      peerConnection.close();

      localStreamRef.current?.getTracks().forEach((track) => {
        track.stop();
      });
    };
  }, []);

  // Display local camera
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Display remote video
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // Start camera and microphone
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
      setStatus("Camera and microphone ready");

      const peerConnection = peerConnectionRef.current;

      if (peerConnection) {
        stream.getTracks().forEach((track) => {
          peerConnection.addTrack(track, stream);
        });
      }
    } catch (error) {
      console.error("Camera access error:", error);
      setStatus("Camera access denied");
    }
  };

  // Toggle camera
  const toggleCamera = async () => {
    if (!localStreamRef.current) {
      await startCamera();
      return;
    }

    const nextState = !cameraOn;

    localStreamRef.current.getVideoTracks().forEach((track) => {
      track.enabled = nextState;
    });

    setCameraOn(nextState);
  };

  // Toggle microphone
  const toggleMicrophone = async () => {
    if (!localStreamRef.current) {
      await startCamera();
      return;
    }

    const nextState = !micOn;

    localStreamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = nextState;
    });

    setMicOn(nextState);
  };

  // Leave meeting
  const stopCamera = () => {
    localStreamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });

    localStreamRef.current = null;
    setLocalStream(null);

    setCameraOn(false);
    setMicOn(false);
    setConnected(false);
    setRemoteStream(null);

    peerConnectionRef.current?.close();
    socketRef.current?.close();

    setStatus("You left the meeting");
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

            {!remoteStream || remoteStream.getTracks().length === 0 ? (
              <div className="video-placeholder">
                <div className="avatar remote-avatar">
                  <Users size={32} />
                </div>

                <h3>Waiting for participant</h3>
                <p>Your conversation partner will appear here</p>

                <span className="waiting-indicator">
                  {connected
                    ? "Connected"
                    : "Waiting to connect..."}
                </span>
              </div>
            ) : null}

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
              title="Leave meeting"
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