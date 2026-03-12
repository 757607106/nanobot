import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell'
import ChatPage from './pages/ChatPage'
import ConfigPage from './pages/ConfigPage'
import CronPage from './pages/CronPage'
import MainPromptPage from './pages/MainPromptPage'
import SkillsPage from './pages/SkillsPage'
import SystemPage from './pages/SystemPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route index element={<Navigate to="/chat" replace />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="cron" element={<CronPage />} />
          <Route path="prompt" element={<MainPromptPage />} />
          <Route path="skills" element={<SkillsPage />} />
          <Route path="config" element={<ConfigPage />} />
          <Route path="system" element={<SystemPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
