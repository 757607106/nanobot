import { useParams } from 'react-router-dom'
import ChatPage from './ChatPage'

export default function AgentChatPage() {
  const { agentId } = useParams()
  return <ChatPage agentId={agentId} />
}

