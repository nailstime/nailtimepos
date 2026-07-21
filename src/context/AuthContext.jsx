import { createContext, useContext, useEffect, useRef, useState } from "react"
import { supabase } from "../lib/supabase"

const Ctx = createContext(null)
export const useAuth = () => useContext(Ctx)

async function ensureAuthSession() {
  const { data: current, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) throw sessionError
  if (current.session) return current.session

  const { data, error } = await supabase.auth.signInAnonymously()
  if (error) throw new Error(
    error.message + " — เปิด Anonymous Sign-Ins ใน Supabase Auth ก่อนใช้งาน"
  )
  return data.session
}

export function AuthProvider({ children }) {
  const [staff, setStaff] = useState(null)
  const [loading, setLoading] = useState(true)
  const authCheckVersion = useRef(0)

  useEffect(() => {
    let active = true
    const version = ++authCheckVersion.current
    ;(async () => {
      try {
        const { data } = await supabase.auth.getSession()
        if (!data.session) return
        const { data: me, error } = await supabase.rpc("staff_me")
        if (error) throw error
        if (active && version === authCheckVersion.current) setStaff(me || null)
      } catch {
        if (active && version === authCheckVersion.current) setStaff(null)
      } finally {
        if (active && version === authCheckVersion.current) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [])

  async function loginWithPin(pin) {
    const version = ++authCheckVersion.current
    setLoading(true)
    try {
      return await completeLogin(pin, version)
    } finally {
      if (version === authCheckVersion.current) setLoading(false)
    }
  }

  async function completeLogin(pin, version) {
    await ensureAuthSession()
    const { data, error } = await supabase.rpc("staff_login", { p_pin: pin })
    if (error) throw error
    if (!data?.ok) {
      if (data?.error === "locked") {
        const minutes = Math.max(1, Math.ceil(Number(data.retry_after_seconds || 60) / 60))
        throw new Error(`ลอง PIN ผิดหลายครั้ง กรุณารอประมาณ ${minutes} นาที`)
      }
      throw new Error(data?.error === "auth_required" ? "ไม่สามารถสร้าง session ได้" : "PIN ไม่ถูกต้อง")
    }
    const { data: me, error: meError } = await supabase.rpc("staff_me")
    if (meError) throw meError
    if (!me) throw new Error("Unable to verify the staff session. Please try again.")
    if (version === authCheckVersion.current) setStaff(me)
    return me
  }

  async function logout() {
    ++authCheckVersion.current
    const { error: sessionError } = await supabase.rpc("staff_logout")
    if (sessionError) throw sessionError
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) throw signOutError
    setStaff(null)
  }

  return <Ctx.Provider value={{ staff, loading, loginWithPin, logout }}>{children}</Ctx.Provider>
}
