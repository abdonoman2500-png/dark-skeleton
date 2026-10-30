"use client";
import { MessageCircle, UsersRound, X } from "lucide-react";
import type { ReactNode } from "react";

export function BrandMark({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark ${small ? "brand-mark-small" : ""}`} aria-hidden="true"><MessageCircle size={small ? 21 : 25} strokeWidth={2.2}/><span className="brand-smile">⌣</span></span>;
}
export function Avatar({ name, src, size = "medium", online = false, group = false, color = "mint" }: { name: string; src?: string | null; size?: "small" | "medium" | "large" | "hero"; online?: boolean; group?: boolean; color?: string }) {
  const letters = name.trim().split(/\s+/).slice(0, 2).map(x => x[0]).join("");
  return <span className={`avatar avatar-${size} avatar-${color} ${group ? "avatar-group" : ""}`} aria-label={name}>{src ? <img src={src} alt="" /> : group ? <UsersRound size={size === "hero" ? 40 : 23} strokeWidth={1.7}/> : <span>{letters || "و"}</span>}{online && <i className="online-dot"/>}</span>;
}
export function Modal({ title, subtitle, onClose, children, className = "" }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; className?: string }) {
  return <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section className={`modal-card ${className}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-btn modal-close" onClick={onClose} aria-label="إغلاق"><X size={19}/></button></div>{children}</section></div>;
}
export function Toggle({ value, onChange, label }: { value: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={value} onClick={() => onChange(!value)} className={`toggle ${value ? "on" : ""}`}><span/></button>;
}
export function formatTime(date: string, lang = "ar", demo?: string) {
  if (demo && lang === "ar") return demo;
  const d = new Date(date); if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return new Intl.DateTimeFormat(lang === "ar" ? "ar" : "en", { hour: "numeric", minute: "2-digit" }).format(d);
  if (Date.now() - d.getTime() < 7 * 86400000) return new Intl.DateTimeFormat(lang === "ar" ? "ar" : "en", { weekday: "short" }).format(d);
  return new Intl.DateTimeFormat(lang === "ar" ? "ar" : "en", { day: "numeric", month: "short" }).format(d);
}
