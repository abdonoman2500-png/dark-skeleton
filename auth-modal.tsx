"use client";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole, Mail, Sparkles, UserRound, X } from "lucide-react";
import { api, type User } from "@/lib/client";
import { BrandMark } from "./ui";

type Mode = "login" | "register" | "forgot" | "reset";
export default function AuthModal({ onClose, onAuth, lang, resetToken }: { onClose: () => void; onAuth: (user: User) => void; lang: string; resetToken?: string | null }) {
  const [mode, setMode] = useState<Mode>(resetToken ? "reset" : "register");
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [show, setShow] = useState(false); const [loading, setLoading] = useState(false); const [error, setError] = useState(""); const [done, setDone] = useState("");
  const ar = lang !== "en"; const txt = (a: string, e: string) => ar ? a : e;
  useEffect(() => { setError(""); setDone(""); }, [mode]);
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(""); setDone(""); setLoading(true);
    try {
      if (mode === "forgot") { const result = await api<{message:string}>("auth/forgot", { method: "POST", body: { email } }); setDone(result.message); }
      else if (mode === "reset") { await api("auth/reset", { method: "POST", body: { token: resetToken, password } }); setDone(txt("تم تحديث كلمة المرور. يمكنك تسجيل الدخول الآن.", "Password updated. You can sign in now.")); setTimeout(() => { setMode("login"); setPassword(""); }, 1500); }
      else { const result = await api<{user: User}>(`auth/${mode}`, { method: "POST", body: mode === "register" ? { name, email, password } : { email, password } }); onAuth(result.user); }
    } catch (err) { setError(err instanceof Error ? err.message : txt("حدث خطأ", "Something went wrong")); } finally { setLoading(false); }
  }
  const heading = mode === "register" ? txt("أهلاً بك في وَصل", "Welcome to Wasl") : mode === "login" ? txt("أهلاً بعودتك", "Welcome back") : mode === "forgot" ? txt("نسيت كلمة المرور؟", "Forgot your password?") : txt("كلمة مرور جديدة", "Set a new password");
  return <div className="modal-overlay auth-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section className="auth-card" role="dialog" aria-modal="true" aria-label={heading}>
    <button className="icon-btn auth-close" onClick={onClose} aria-label={txt("إغلاق", "Close")}><X size={20}/></button>
    <div className="auth-form-side"><div className="auth-brand"><BrandMark small/><strong>وَصل</strong><span>wasl</span></div><div className="auth-heading"><div className="eyebrow"><Sparkles size={14}/>{txt("تواصل يشبهك", "CONNECTION, MADE PERSONAL")}</div><h2>{heading}</h2><p>{mode === "register" ? txt("مساحة أقرب لمن تحب، تبدأ ببريدك الإلكتروني.", "A little closer to your people, starting with your email.") : mode === "login" ? txt("سجّل دخولك وتابع أحاديثك من حيث توقفت.", "Sign in and pick up where you left off.") : mode === "forgot" ? txt("أدخل بريدك وسنرسل لك رابط الاستعادة إن كان مسجلاً.", "Enter your email to receive a recovery link.") : txt("اختر كلمة مرور قوية لحماية حسابك.", "Choose a strong password to protect your account.")}</p></div>
      <form onSubmit={submit} className="auth-form">
        {mode === "register" && <label>{txt("الاسم", "Your name")}<span className="input-wrap"><UserRound size={17}/><input autoFocus required minLength={2} maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder={txt("كيف تحب أن نناديك؟", "What should we call you?")}/></span></label>}
        {mode !== "reset" && <label>{txt("البريد الإلكتروني", "Email address")}<span className="input-wrap"><Mail size={17}/><input type="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" dir="ltr"/></span></label>}
        {mode !== "forgot" && <label>{txt("كلمة المرور", "Password")}<span className="input-wrap"><LockKeyhole size={17}/><input type={show ? "text" : "password"} required minLength={mode === "login" ? 1 : 8} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} placeholder={txt("٨ أحرف على الأقل", "At least 8 characters")} dir="auto"/><button type="button" className="input-action" onClick={() => setShow(!show)} aria-label="Toggle password">{show ? <EyeOff size={17}/> : <Eye size={17}/>}</button></span></label>}
        {mode === "login" && <button type="button" className="text-link forgot-link" onClick={() => setMode("forgot")}>{txt("نسيت كلمة المرور؟", "Forgot password?")}</button>}
        {error && <p className="form-error" role="alert">{error}</p>}{done && <p className="form-success">{done}</p>}
        <button className="primary-button auth-submit" disabled={loading}>{loading ? txt("لحظة من فضلك...", "Please wait...") : mode === "register" ? txt("إنشاء حساب", "Create account") : mode === "login" ? txt("تسجيل الدخول", "Sign in") : mode === "forgot" ? txt("إرسال رابط الاستعادة", "Send recovery link") : txt("حفظ كلمة المرور", "Save password")} {ar ? <ArrowLeft size={17}/> : <ArrowRight size={17}/>}</button>
      </form>
      <div className="auth-switch">{mode === "register" ? txt("لديك حساب بالفعل؟", "Already have an account?") : txt("ليس لديك حساب؟", "New to Wasl?")} <button className="text-link" onClick={() => setMode(mode === "register" ? "login" : "register")}>{mode === "register" ? txt("تسجيل الدخول", "Sign in") : txt("أنشئ حساباً", "Create an account")}</button></div>
      <p className="auth-foot">{txt("بدون رقم هاتف. فقط أنت ومن تحب.", "No phone number. Just you and your people.")}</p>
    </div><div className="auth-art"><div className="auth-art-top"><BrandMark/><span>وَصل</span></div><div className="auth-art-bubbles"><div>كيف كان يومك؟ ☀️</div><div>أجمل الآن لأننا نتحدث 🤍</div><div>دائماً قريبين، مهما بعدت المسافات ✨</div></div><div className="auth-art-copy"><span>مساحتك للتواصل</span><h3>الأحاديث الجميلة<br/>تبدأ من هنا.</h3><p>كن قريباً ممن تحب، في كل وقت ومن أي مكان.</p></div><div className="auth-art-orb one"/><div className="auth-art-orb two"/></div>
  </section></div>;
}
