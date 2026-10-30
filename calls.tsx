"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Mic, MicOff, Phone, PhoneCall, PhoneOff, RefreshCw, SwitchCamera, Video } from "lucide-react";
import { api, type Conversation, type Profile, type User } from "@/lib/client";
import { Avatar } from "./ui";

type Call = { id: string; conversationId: string; callerId: string; calleeId: string; mode: "audio" | "video"; state: string; answeredAt: string | null; caller?: Profile; label?: string; avatar?: string | null };
type Signal = { id: string; kind: "offer" | "answer" | "candidate"; payload: RTCSessionDescriptionInit & RTCIceCandidateInit };
type Request = { room: Conversation; mode: "audio" | "video"; nonce: number } | null;

export default function CallManager({ user, request, clearRequest, toast, lang }: { user: User | null; request: Request; clearRequest: () => void; toast: (message: string) => void; lang: string }) {
  const [incoming, setIncoming] = useState<Call | null>(null); const [call, setCall] = useState<Call | null>(null); const [connection, setConnection] = useState("connecting");
  const [muted, setMuted] = useState(false); const [cameraOff, setCameraOff] = useState(false); const [seconds, setSeconds] = useState(0); const [remote, setRemote] = useState<MediaStream | null>(null); const [local, setLocal] = useState<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null); const streamRef = useRef<MediaStream | null>(null); const seen = useRef(new Set<string>()); const pending = useRef<RTCIceCandidateInit[]>([]); const remoteVideo = useRef<HTMLVideoElement>(null); const localVideo = useRef<HTMLVideoElement>(null); const remoteAudio = useRef<HTMLAudioElement>(null); const facing = useRef<"user" | "environment">("user"); const starting = useRef(false);
  const ar = lang !== "en"; const t = (a: string, e: string) => ar ? a : e;
  function cleanup() { pcRef.current?.close(); pcRef.current = null; streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null; setLocal(null); setRemote(null); seen.current.clear(); pending.current = []; setMuted(false); setCameraOff(false); setSeconds(0); setConnection("connecting"); }
  async function signal(id: string, kind: string, payload: unknown) { await api(`calls/${id}/signal`, { method: "POST", body: { kind, payload } }); }
  async function setup(item: Call, servers: RTCIceServer[]) {
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") throw new Error(t("المكالمات تحتاج متصفحاً آمناً وصلاحية الميكروفون.", "Calls require a secure browser and microphone permission."));
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: item.mode === "video" ? { facingMode: facing.current } : false }); streamRef.current = stream; setLocal(stream);
    const pc = new RTCPeerConnection({ iceServers: servers }); pcRef.current = pc; stream.getTracks().forEach(track => pc.addTrack(track, stream));
    pc.onicecandidate = event => { if (event.candidate) signal(item.id, "candidate", event.candidate.toJSON()).catch(() => {}); };
    pc.ontrack = event => { if (event.streams[0]) setRemote(event.streams[0]); };
    pc.onconnectionstatechange = () => setConnection(pc.connectionState);
    return pc;
  }
  async function finish(action: "end" | "reject" = "end", id = call?.id) {
    if (id) try { await api(`calls/${id}`, { method: "PATCH", body: { action } }); } catch { /* other side may already have ended */ }
    cleanup(); setCall(null); setIncoming(null);
  }
  useEffect(() => { if (!user) { cleanup(); setCall(null); setIncoming(null); return; } let cancelled = false;
    const poll = async () => { try { const data = await api<{ incoming: Call | null }>("calls"); if (!cancelled && !call && !starting.current) setIncoming(data.incoming); } catch { /* retry */ } };
    poll(); const timer = setInterval(poll, 3000); return () => { cancelled = true; clearInterval(timer); };
  }, [user?.id, call?.id]);
  useEffect(() => { if (!request || !user || starting.current) return; starting.current = true; let callId = "";
    (async () => { try {
      const result = await api<{call: Call; iceServers: RTCIceServer[]}>("calls", { method: "POST", body: { conversationId: request.room.id, mode: request.mode } }); callId = result.call.id;
      const item = { ...result.call, label: request.room.name, avatar: request.room.avatar }; setCall(item); setIncoming(null);
      const pc = await setup(item, result.iceServers); const offer = await pc.createOffer(); await pc.setLocalDescription(offer); await signal(item.id, "offer", offer);
    } catch (e) { if (callId) await finish("end", callId); toast(e instanceof Error ? e.message : t("تعذرت المكالمة", "Could not start call")); } finally { starting.current = false; clearRequest(); } })();
  }, [request?.nonce]);
  async function accept() {
    if (!incoming) return; starting.current = true;
    try { const data = await api<{call: Call; iceServers: RTCIceServer[]}>(`calls/${incoming.id}`); const item = { ...data.call, label: incoming.caller?.name || t("مكالمة واردة", "Incoming call"), avatar: incoming.caller?.avatar }; await setup(item, data.iceServers); await api(`calls/${item.id}`, { method: "PATCH", body: { action: "accept" } }); setCall({ ...item, state: "active", answeredAt: new Date().toISOString() }); setIncoming(null); }
    catch (e) { await finish("reject", incoming.id); toast(e instanceof Error ? e.message : t("تعذرت المكالمة", "Could not answer call")); } finally { starting.current = false; }
  }
  useEffect(() => { if (!call) return; let cancelled = false, busy = false;
    const poll = async () => { if (busy) return; busy = true; try {
      const data = await api<{call: Call; signals: Signal[]}>(`calls/${call.id}`); if (cancelled) return;
      if (["ended", "rejected"].includes(data.call.state)) { cleanup(); setCall(null); toast(data.call.state === "rejected" ? t("تم رفض المكالمة", "Call declined") : t("انتهت المكالمة", "Call ended")); return; }
      setCall(old => old ? { ...old, state: data.call.state, answeredAt: data.call.answeredAt } : old);
      const pc = pcRef.current; if (!pc) return;
      for (const item of data.signals) {
        if (seen.current.has(item.id)) continue; seen.current.add(item.id);
        if (item.kind === "offer") { await pc.setRemoteDescription(new RTCSessionDescription(item.payload)); const answer = await pc.createAnswer(); await pc.setLocalDescription(answer); await signal(call.id, "answer", answer); }
        else if (item.kind === "answer" && pc.signalingState !== "stable") await pc.setRemoteDescription(new RTCSessionDescription(item.payload));
        else if (item.kind === "candidate") { if (pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(item.payload)); else pending.current.push(item.payload); }
        if (pc.remoteDescription && pending.current.length) { const queued = pending.current.splice(0); for (const candidate of queued) await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {}); }
      }
    } catch (e) { console.error("Call signaling", e); } finally { busy = false; } };
    poll(); const timer = setInterval(poll, 1500); return () => { cancelled = true; clearInterval(timer); };
  }, [call?.id]);
  useEffect(() => { if (remoteVideo.current) remoteVideo.current.srcObject = remote; if (remoteAudio.current) remoteAudio.current.srcObject = remote; }, [remote, call?.id]);
  useEffect(() => { if (localVideo.current) localVideo.current.srcObject = local; }, [local, call?.id]);
  useEffect(() => { if (!call?.answeredAt) return; const tick = () => setSeconds(Math.max(0, Math.floor((Date.now() - new Date(call.answeredAt!).getTime()) / 1000))); tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer); }, [call?.answeredAt]);
  useEffect(() => () => { pcRef.current?.close(); streamRef.current?.getTracks().forEach(track => track.stop()); }, []);
  function toggleMic() { streamRef.current?.getAudioTracks().forEach(track => { track.enabled = muted; }); setMuted(!muted); }
  function toggleCamera() { streamRef.current?.getVideoTracks().forEach(track => { track.enabled = cameraOff; }); setCameraOff(!cameraOff); }
  async function switchCamera() { try { const next = facing.current === "user" ? "environment" : "user"; const fresh = await navigator.mediaDevices.getUserMedia({ video: { facingMode: next }, audio: false }); const track = fresh.getVideoTracks()[0]; const sender = pcRef.current?.getSenders().find(s => s.track?.kind === "video"); await sender?.replaceTrack(track); const old = streamRef.current?.getVideoTracks()[0]; if (old && streamRef.current) { streamRef.current.removeTrack(old); old.stop(); streamRef.current.addTrack(track); setLocal(new MediaStream(streamRef.current.getTracks())); } facing.current = next; } catch { toast(t("تعذر تبديل الكاميرا", "Could not switch camera")); } }
  async function reconnect() { if (!call || !pcRef.current) return; try { const pc = pcRef.current; pc.restartIce(); const offer = await pc.createOffer({ iceRestart: true }); await pc.setLocalDescription(offer); await signal(call.id, "offer", offer); setConnection("connecting"); } catch { toast(t("تعذرت إعادة الاتصال", "Could not reconnect")); } }
  if (!incoming && !call) return null;
  if (incoming && !call) return <div className="call-overlay"><div className="call-card"><div className="call-pulse"><Avatar name={incoming.caller?.name || "وَصل"} src={incoming.caller?.avatar} size="hero"/></div><p className="call-kicker">{incoming.mode === "video" ? t("مكالمة فيديو واردة", "Incoming video call") : t("مكالمة صوتية واردة", "Incoming voice call")}</p><h2>{incoming.caller?.name}</h2><p>{t("يريد التواصل معك", "is calling you")}</p><div className="call-actions"><button className="call-action decline" onClick={() => finish("reject", incoming.id)} aria-label={t("رفض", "Decline")}><PhoneOff/></button><button className="call-action accept" onClick={accept} aria-label={t("قبول", "Accept")}><Phone/></button></div></div></div>;
  if (!call) return null;
  const duration = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return <div className="call-overlay"><div className={`call-card ${call.mode === "video" ? "video-call-card" : ""}`}>
    {call.mode === "video" && remote ? <video ref={remoteVideo} autoPlay playsInline className="remote-video"/> : <div className="call-pulse"><Avatar name={call.label || "وَصل"} src={call.avatar} size="hero"/></div>}
    {call.mode === "video" && local && <video ref={localVideo} autoPlay muted playsInline className="local-video"/>}{call.mode === "audio" && <audio ref={remoteAudio} autoPlay/>}
    <div className="call-description"><p className="call-kicker">{call.mode === "video" ? <Video size={15}/> : <PhoneCall size={15}/>} {call.mode === "video" ? t("مكالمة فيديو", "Video call") : t("مكالمة صوتية", "Voice call")}</p><h2>{call.label}</h2><p>{connection === "connected" ? duration : connection === "failed" || connection === "disconnected" ? t("انقطع الاتصال", "Connection interrupted") : call.state === "ringing" ? t("جارٍ الاتصال...", "Calling...") : t("جارٍ الاتصال...", "Connecting...")}</p></div>
    <div className="call-actions"><button className={`call-action secondary ${muted ? "selected" : ""}`} onClick={toggleMic} aria-label="Microphone">{muted ? <MicOff/> : <Mic/>}</button>{call.mode === "video" && <><button className={`call-action secondary ${cameraOff ? "selected" : ""}`} onClick={toggleCamera} aria-label="Camera">{cameraOff ? <CameraOff/> : <Camera/>}</button><button className="call-action secondary" onClick={switchCamera} aria-label="Switch camera"><SwitchCamera/></button></>}{(connection === "failed" || connection === "disconnected") && <button className="call-action secondary" onClick={reconnect} aria-label="Reconnect"><RefreshCw/></button>}<button className="call-action decline" onClick={() => finish()} aria-label={t("إنهاء المكالمة", "End call")}><PhoneOff/></button></div>
  </div></div>;
}
