import { fireEvent, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockApi = vi.hoisted(() => ({
  createSession: vi.fn(),
  createAgentTemplate: vi.fn(),
  createCalendarEvent: vi.fn(),
  deleteSession: vi.fn(),
  health: vi.fn(),
  getAgentTemplate: vi.fn(),
  getAgentTemplates: vi.fn(),
  getAuthStatus: vi.fn(),
  bootstrapAuth: vi.fn(),
  getChatWorkspace: vi.fn(),
  getCalendarEvents: vi.fn(),
  getCalendarJobs: vi.fn(),
  getCalendarSettings: vi.fn(),
  getChannel: vi.fn(),
  getChannels: vi.fn(),
  getWhatsAppBindingStatus: vi.fn(),
  testChannel: vi.fn(),
  getDocument: vi.fn(),
  getDocuments: vi.fn(),
  getMcpServer: vi.fn(),
  getMcpServers: vi.fn(),
  getMcpRepairPlan: vi.fn(),
  getMcpTestChat: vi.fn(),
  getOpsActions: vi.fn(),
  getOpsLogs: vi.fn(),
  getProfile: vi.fn(),
  getSetupStatus: vi.fn(),
  probeMcpServer: vi.fn(),
  runMcpRepair: vi.fn(),
  sendMcpTestChatMessage: vi.fn(),
  clearMcpTestChat: vi.fn(),
  runValidation: vi.fn(),
  setMcpServerEnabled: vi.fn(),
  rotateProfilePassword: vi.fn(),
  triggerOpsAction: vi.fn(),
  uploadChatFile: vi.fn(),
  uploadProfileAvatar: vi.fn(),
  deleteProfileAvatar: vi.fn(),
  updateProfile: vi.fn(),
  updateMcpServer: vi.fn(),
  deleteMcpServer: vi.fn(),
  deleteAgentTemplate: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  getSessions: vi.fn(),
  getMessages: vi.fn(),
  getConfig: vi.fn(),
  getConfigMeta: vi.fn(),
  getSystemStatus: vi.fn(),
  getCronStatus: vi.fn(),
  getCronJobs: vi.fn(),
  getInstalledSkills: vi.fn(),
  getValidTemplateTools: vi.fn(),
  importAgentTemplates: vi.fn(),
  exportAgentTemplates: vi.fn(),
  reloadAgentTemplates: vi.fn(),
  resetDocument: vi.fn(),
  renameSession: vi.fn(),
  updateDocument: vi.fn(),
  updateAgentTemplate: vi.fn(),
  updateCalendarEvent: vi.fn(),
  updateCalendarSettings: vi.fn(),
  updateChannel: vi.fn(),
  updateChannelDelivery: vi.fn(),
  startWhatsAppBinding: vi.fn(),
  stopWhatsAppBinding: vi.fn(),
  updateSetupAgentDefaults: vi.fn(),
  updateSetupChannel: vi.fn(),
  updateSetupProvider: vi.fn(),
}))

vi.mock('../api', () => ({
  ApiError: class MockApiError extends Error {
    statusCode = 0
    code?: string
    details?: unknown
  },
  api: mockApi,
}))

vi.mock('antd/locale/zh_CN', () => ({
  default: {},
}))

vi.mock('antd/es/input/TextArea', async () => {
  const React = await import('react')

  const TextArea = React.forwardRef<
    HTMLTextAreaElement,
    {
      className?: string
      placeholder?: string
      value?: string
      disabled?: boolean
      onChange?: React.ChangeEventHandler<HTMLTextAreaElement>
    }
  >(({ className, placeholder, value, disabled, onChange }, ref) => (
    <textarea
      ref={ref}
      className={className}
      placeholder={placeholder}
      value={value}
      disabled={disabled}
      onChange={onChange}
    />
  ))
  TextArea.displayName = 'MockTextArea'

  return {
    default: TextArea,
  }
})

vi.mock('@ant-design/icons', async () => {
  const React = await import('react')

  function makeIcon(label: string) {
    return function MockIcon() {
      return <span data-icon={label} />
    }
  }

  return {
    ApiOutlined: makeIcon('api'),
    AppstoreOutlined: makeIcon('appstore'),
    ArrowLeftOutlined: makeIcon('arrow-left'),
    BookOutlined: makeIcon('book'),
    CalendarOutlined: makeIcon('calendar'),
    ClockCircleOutlined: makeIcon('clock'),
    ClusterOutlined: makeIcon('cluster'),
    CodeOutlined: makeIcon('code'),
    DeleteOutlined: makeIcon('delete'),
    DesktopOutlined: makeIcon('desktop'),
    DownloadOutlined: makeIcon('download'),
    EditOutlined: makeIcon('edit'),
    EyeOutlined: makeIcon('eye'),
    FileTextOutlined: makeIcon('file-text'),
    FolderOpenOutlined: makeIcon('folder-open'),
    LinkOutlined: makeIcon('link'),
    LogoutOutlined: makeIcon('logout'),
    MenuOutlined: makeIcon('menu'),
    MessageOutlined: makeIcon('message'),
    MoonOutlined: makeIcon('moon'),
    NodeIndexOutlined: makeIcon('node-index'),
    PaperClipOutlined: makeIcon('paper-clip'),
    PauseCircleOutlined: makeIcon('pause'),
    PlayCircleOutlined: makeIcon('play'),
    PlusOutlined: makeIcon('plus'),
    ProfileOutlined: makeIcon('profile'),
    ReloadOutlined: makeIcon('reload'),
    RobotOutlined: makeIcon('robot'),
    SaveOutlined: makeIcon('save'),
    SearchOutlined: makeIcon('search'),
    SettingOutlined: makeIcon('setting'),
    SunOutlined: makeIcon('sun'),
    ToolOutlined: makeIcon('tool'),
    UploadOutlined: makeIcon('upload'),
    UserOutlined: makeIcon('user'),
    CloudUploadOutlined: makeIcon('cloud-upload'),
  }
})

vi.mock('@ant-design/x', async () => {
  const React = await import('react')

  const BubbleList = ({ items = [] }: { items?: Array<Record<string, unknown>> }) => (
    <div>
      {items.map((item, index) => (
        <div key={String(item.key ?? index)}>
          {item.header as React.ReactNode}
          {item.content as React.ReactNode}
          {item.footer as React.ReactNode}
        </div>
      ))}
    </div>
  )

  const Bubble = {
    List: BubbleList,
  }

  const Conversations = ({ items = [] }: { items?: Array<Record<string, unknown>> }) => (
    <div>
      {items.map((item, index) => (
        <div key={String(item.key ?? index)}>{item.label as React.ReactNode}</div>
      ))}
    </div>
  )

  const Sender = React.forwardRef<
    { focus: () => void },
    {
      placeholder?: string
      loading?: boolean
      value?: string
      prefix?: React.ReactNode
      header?: React.ReactNode
      footer?: React.ReactNode
      onChange?: (value: string) => void
      onSubmit?: (value: string) => void
      onCancel?: () => void
      onPasteFile?: (file: File) => void
    }
  >(({ footer, header, loading, onCancel, onChange, onPasteFile, onSubmit, placeholder, prefix, value }, ref) => {
    const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)

    React.useImperativeHandle(ref, () => ({
      focus() {
        textareaRef.current?.focus()
      },
    }))

    return (
      <div>
        {header}
        {prefix}
        <textarea
          ref={textareaRef}
          aria-label="sender"
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          onPaste={(event) => {
            const file = event.clipboardData.files?.[0]
            if (file) {
              onPasteFile?.(file)
            }
          }}
        />
        <button type="button" onClick={() => onSubmit?.(value ?? '')}>
          submit
        </button>
        <button type="button" onClick={onCancel}>
          cancel
        </button>
        {loading ? <span>loading</span> : null}
        {footer}
      </div>
    )
  })
  Sender.displayName = 'MockSender'

  const Welcome = ({
    description,
    extra,
    icon,
    title,
  }: {
    description?: React.ReactNode
    extra?: React.ReactNode
    icon?: React.ReactNode
    title?: React.ReactNode
  }) => (
    <section>
      {icon}
      <div>{title}</div>
      <div>{description}</div>
      {extra}
    </section>
  )

  const Prompts = ({
    items = [],
    onItemClick,
  }: {
    items?: Array<Record<string, unknown>>
    onItemClick?: (info: { data: Record<string, unknown> }) => void
  }) => (
    <div>
      {items.map((item, index) => (
        <button key={String(item.key ?? index)} type="button" onClick={() => onItemClick?.({ data: item })}>
          {(item.label as React.ReactNode) ?? (item.description as React.ReactNode)}
        </button>
      ))}
    </div>
  )

  const ThoughtChain = ({
    items = [],
  }: {
    items?: Array<Record<string, unknown>>
  }) => (
    <div>
      {items.map((item, index) => (
        <div key={String(item.key ?? index)}>
          {item.icon as React.ReactNode}
          <span>{item.title as React.ReactNode}</span>
          <span>{item.description as React.ReactNode}</span>
        </div>
      ))}
    </div>
  )

  const Attachments = ({
    children,
    items = [],
    onChange,
    placeholder,
  }: {
    children?: React.ReactNode
    items?: Array<Record<string, unknown>>
    onChange?: (info: { fileList: Array<Record<string, unknown>> }) => void
    placeholder?: {
      icon?: React.ReactNode
      title?: React.ReactNode
      description?: React.ReactNode
    }
  }) => (
    <div>
      {children}
      <div>{placeholder?.icon}</div>
      <div>{placeholder?.title}</div>
      <div>{placeholder?.description}</div>
      <div>
        {items.map((item, index) => (
          <span key={String(item.uid ?? index)}>{(item.name as React.ReactNode) ?? 'attachment'}</span>
        ))}
      </div>
      <button type="button" onClick={() => onChange?.({ fileList: items })}>
        update attachments
      </button>
    </div>
  )

  return {
    Attachments,
    Bubble,
    Conversations,
    Prompts,
    Sender,
    ThoughtChain,
    Welcome,
  }
})

vi.mock('antd', async () => {
  const React = await import('react')

  type Props = React.PropsWithChildren<{
    className?: string
    title?: React.ReactNode
    extra?: React.ReactNode
    actions?: React.ReactNode[]
    open?: boolean
    onClick?: () => void
    onChange?: (...args: unknown[]) => void
    checked?: boolean
    value?: unknown
    options?: Array<{ label: React.ReactNode; value: string | number }>
    items?: Array<{ key?: string; label?: React.ReactNode; children?: React.ReactNode; icon?: React.ReactNode }>
    selectedKeys?: string[]
    activeKey?: string
    icon?: React.ReactNode
    label?: React.ReactNode
    message?: React.ReactNode
    description?: React.ReactNode
    dataSource?: unknown[]
    renderItem?: (item: unknown) => React.ReactNode
    disabled?: boolean
    placeholder?: string
    htmlType?: 'button' | 'submit' | 'reset'
    onClose?: (event: React.MouseEvent<HTMLElement>) => void
    [key: string]: unknown
  }>

  function Box({ children, className }: Props) {
    return <div className={className}>{children}</div>
  }

  const AppProvider = ({ children }: React.PropsWithChildren) => <div>{children}</div>
  AppProvider.useApp = () => ({
    message: {
      error: vi.fn(),
      success: vi.fn(),
    },
    modal: {
      confirm: vi.fn(),
    },
  })

  const Button = ({ children, className, disabled, htmlType, icon, onClick }: Props) => (
    <button
      type={htmlType ?? 'button'}
      className={className}
      disabled={Boolean(disabled)}
      onClick={onClick}
    >
      {icon as React.ReactNode}
      {children}
    </button>
  )

  const Card = ({ title, extra, children, actions, className }: Props) => (
    <section className={className}>
      {title}
      {extra}
      {children}
      {actions?.map((action, index) => <div key={index}>{action}</div>)}
    </section>
  )

  const InputBase = React.forwardRef<HTMLInputElement, Props>((props, ref) => {
    const { className, disabled, onChange, placeholder, value } = props as {
      className?: string
      disabled?: boolean
      onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
      placeholder?: string
      value?: string | number
    }

    return (
      <input
        ref={ref}
        className={className}
        disabled={Boolean(disabled)}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange?.(event)}
      />
    )
  })
  InputBase.displayName = 'MockInput'
  const PasswordInput = React.forwardRef<HTMLInputElement, Props>((props, ref) => {
    const { className, disabled, onChange, placeholder, value } = props as {
      className?: string
      disabled?: boolean
      onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
      placeholder?: string
      value?: string | number
    }

    return (
      <input
        ref={ref}
        type="password"
        className={className}
        disabled={Boolean(disabled)}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange?.(event)}
      />
    )
  })
  PasswordInput.displayName = 'MockPasswordInput'
  const TextAreaInput = React.forwardRef<HTMLTextAreaElement, Props>((props, ref) => {
    const { className, disabled, onChange, placeholder, value } = props as {
      className?: string
      disabled?: boolean
      onChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void
      placeholder?: string
      value?: string
    }

    return (
      <textarea
        ref={ref}
        className={className}
        disabled={Boolean(disabled)}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange?.(event)}
      />
    )
  })
  TextAreaInput.displayName = 'MockInputTextArea'

  const Input = Object.assign(InputBase, {
    Password: PasswordInput,
    TextArea: TextAreaInput,
  })

  const InputNumber = ({ className, disabled, onChange, placeholder, value }: Props) => (
    <input
      type="number"
      className={className}
      disabled={Boolean(disabled)}
      placeholder={typeof placeholder === 'string' ? placeholder : undefined}
      value={value as number | string | undefined}
      onChange={(event) => onChange?.(Number(event.target.value))}
    />
  )

  const Select = ({ className, disabled, onChange, options = [], value }: Props) => (
    <select
      className={className}
      disabled={Boolean(disabled)}
      value={typeof value === 'string' || typeof value === 'number' ? value : undefined}
      onChange={(event) => onChange?.(event.target.value)}
    >
      {options.map((option, index) => (
        <option key={index} value={option.value}>
          {option.label as React.ReactNode}
        </option>
      ))}
    </select>
  )

  const Switch = ({ checked, className, disabled, onChange }: Props) => (
    <input
      type="checkbox"
      className={className}
      disabled={Boolean(disabled)}
      checked={Boolean(checked)}
      onChange={(event) => onChange?.(event.target.checked)}
    />
  )

  const Segmented = ({ options = [] }: Props) => (
    <div>
      {options.map((option, index) => (
        <span key={index}>{(option as { label: React.ReactNode }).label}</span>
      ))}
    </div>
  )

  const Tabs = ({ items = [] }: Props) => (
    <div>
      {items.map((item, index) => (
        <section key={item.key ?? index}>
          <div>{item.label as React.ReactNode}</div>
          <div>{item.children as React.ReactNode}</div>
        </section>
      ))}
    </div>
  )

  const Modal = ({ children, open }: Props) => (open ? <div>{children}</div> : null)

  const Popconfirm = ({ children }: Props) => <>{children}</>

  const Alert = ({ message, description }: Props) => (
    <div>
      <strong>{message as React.ReactNode}</strong>
      <div>{description as React.ReactNode}</div>
    </div>
  )

  const Divider = () => <hr />
  const Tag = ({ children, icon, onClose }: Props) => (
    <span>
      {icon}
      {children}
      {onClose ? (
        <button type="button" onClick={(event) => onClose(event)}>
          close
        </button>
      ) : null}
    </span>
  )
  const Tooltip = ({ children }: Props) => <>{children}</>
  const QRCode = ({ value }: { value?: string }) => <div data-qrcode={value}>QR</div>

  const Empty = Object.assign(
    ({ description }: { description?: React.ReactNode }) => <div>{description}</div>,
    { PRESENTED_IMAGE_SIMPLE: null },
  )

  const Spin = () => <div>loading</div>

  const Typography = {
    Title: ({ children }: Props) => <div>{children}</div>,
    Paragraph: ({ children }: Props) => <p>{children}</p>,
    Text: ({ children }: Props) => <span>{children}</span>,
  }

  const Space = Box
  const Row = Box
  const Col = Box
  const Flex = Box

  const List = Object.assign(
    ({ dataSource = [], renderItem }: Props & { dataSource?: unknown[]; renderItem?: (item: unknown) => React.ReactNode }) => (
      <div>{dataSource.map((item, index) => <div key={index}>{renderItem?.(item)}</div>)}</div>
    ),
    {
      Item: ({ children }: Props) => <div>{children}</div>,
    },
  )

  const FormComponent = ({ children }: Props) => <form>{children}</form>
  const Form = Object.assign(FormComponent, {
    useForm: () => [
      {
        resetFields: vi.fn(),
        setFieldsValue: vi.fn(),
        validateFields: vi.fn().mockResolvedValue({}),
      },
    ],
    Item: ({ children, label }: Props) => {
      if (typeof children === 'function') {
        return <>{(children as (api: { getFieldValue: (name: string) => string }) => React.ReactNode)({
          getFieldValue: () => 'cron',
        })}</>
      }
      return (
        <label>
          {label}
          {children}
        </label>
      )
    },
  })

  const Radio = {
    Group: ({ children }: Props) => <div>{children}</div>,
    Button: ({ children, value }: Props) => <button type="button" data-value={value as string}>{children}</button>,
  }

  const Drawer = ({ children, open }: Props) => (open ? <div>{children}</div> : null)

  const LayoutBase = ({ children, className }: Props) => <div className={className}>{children}</div>
  const Layout = Object.assign(LayoutBase, {
    Header: LayoutBase,
    Sider: LayoutBase,
    Content: LayoutBase,
  })

  const Menu = ({ items = [] }: Props) => (
    <nav>
      {items.map((item, index) => (
        <div key={(item as { key?: string }).key ?? index}>
          {(item as { icon?: React.ReactNode }).icon}
          {(item as { label?: React.ReactNode }).label as React.ReactNode}
        </div>
      ))}
    </nav>
  )

  const Grid = {
    useBreakpoint: () => ({
      lg: window.matchMedia('(min-width: 992px)').matches,
    }),
  }

  const ConfigProvider = ({ children }: React.PropsWithChildren) => <>{children}</>

  return {
    Alert,
    App: AppProvider,
    Button,
    Card,
    Col,
    ConfigProvider,
    Divider,
    Drawer,
    Empty,
    Flex,
    Form,
    Grid,
    Input,
    InputNumber,
    Layout,
    List,
    Menu,
    Modal,
    Popconfirm,
    Radio,
    Row,
    QRCode,
    Segmented,
    Select,
    Space,
    Spin,
    Switch,
    Tabs,
    Tag,
    Tooltip,
    Typography,
  }
})

import { AppRoutes } from '../App'
import AppShell from '../components/AppShell'
import CalendarPage from '../pages/CalendarPage'
import ChannelDetailPage from '../pages/ChannelDetailPage'
import ChannelsPage from '../pages/ChannelsPage'
import ChatPage from '../pages/ChatPage'
import CronPage from '../pages/CronPage'
import MainPromptPage from '../pages/MainPromptPage'
import McpPage from '../pages/McpPage'
import McpServerDetailPage from '../pages/McpServerDetailPage'
import ModelsPage from '../pages/ModelsPage'
import OperationsPage from '../pages/OperationsPage'
import ProfilePage from '../pages/ProfilePage'
import SkillsPage from '../pages/SkillsPage'
import SetupPage from '../pages/SetupPage'
import SystemLayoutPage from '../pages/SystemLayoutPage'
import SystemPage from '../pages/SystemPage'
import TemplatesPage from '../pages/TemplatesPage'
import ValidationPage from '../pages/ValidationPage'
import { renderWithProviders } from '../test/renderApp'

function installMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

function makeSystemStatus() {
  return {
    web: {
      version: '0.1.4.post4',
      uptime: 120,
      workspace: '/tmp/workspace',
      configPath: '/tmp/config.json',
      model: 'deepseek/deepseek-chat',
      provider: 'deepseek',
    },
    stats: {
      totalSessions: 2,
      webSessions: 2,
      messages: 4,
      enabledChannels: ['telegram'],
      enabledChannelCount: 1,
      scheduledJobs: 1,
    },
    environment: {
      python: '3.11.11',
      platform: 'darwin',
    },
    cron: {
      enabled: true,
      jobs: 1,
      nextWakeAtMs: Date.now() + 60_000,
      deliveryMode: 'agent_only' as const,
    },
  }
}

function makeConfig() {
  return {
    agents: {
      defaults: {
        workspace: '/tmp/workspace',
        model: 'deepseek/deepseek-chat',
        provider: 'deepseek',
        maxTokens: 4096,
        contextWindowTokens: 128000,
        temperature: 0.7,
        maxToolIterations: 12,
        reasoningEffort: 'medium',
      },
    },
    providers: {
      deepseek: {
        apiKey: 'sk-test',
        apiBase: 'https://api.deepseek.com',
        extraHeaders: {},
      },
      openai_codex: {
        apiKey: '',
        apiBase: null,
        extraHeaders: {},
      },
    },
    channels: {
      sendProgress: true,
      sendToolHints: true,
      telegram: {
        enabled: true,
        token: '123',
        allowFrom: ['123'],
      },
    },
    gateway: {
      host: '127.0.0.1',
      port: 18790,
      heartbeat: {
        enabled: true,
        intervalS: 1800,
      },
    },
    tools: {
      restrictToWorkspace: true,
      web: {
        proxy: '',
        search: {
          apiKey: '',
          maxResults: 5,
        },
      },
      mcpServers: {},
    },
  }
}

function makeConfigMeta() {
  return {
    providers: [
      {
        name: 'deepseek',
        label: 'DeepSeek',
        category: 'standard' as const,
        keywords: ['deepseek'],
        defaultApiBase: 'https://api.deepseek.com',
        supportsPromptCaching: false,
        isGateway: false,
        isLocal: false,
        isOauth: false,
        isDirect: false,
      },
      {
        name: 'openai_codex',
        label: 'OpenAI Codex',
        category: 'oauth' as const,
        keywords: ['openai', 'codex'],
        defaultApiBase: null,
        supportsPromptCaching: false,
        isGateway: false,
        isLocal: false,
        isOauth: true,
        isDirect: false,
      },
    ],
    resolvedProvider: 'deepseek',
  }
}

function makeChannelsList() {
  return {
    delivery: {
      sendProgress: true,
      sendToolHints: true,
    },
    items: [
      {
        name: 'telegram',
        enabled: true,
        configured: true,
        touched: true,
        status: 'enabled' as const,
        statusLabel: '已启用',
        statusDetail: '当前实例会在运行时加载 Telegram 渠道。',
        missingRequiredFields: [],
      },
      {
        name: 'discord',
        enabled: false,
        configured: false,
        touched: true,
        status: 'incomplete' as const,
        statusLabel: '待补全',
        statusDetail: 'Discord 渠道仍缺少必要字段。',
        missingRequiredFields: ['token'],
      },
    ],
  }
}

function makeChannelDetail(channelName = 'telegram') {
  const list = makeChannelsList()
  const channel = list.items.find((item) => item.name === channelName) ?? list.items[0]
  const configMap: Record<string, Record<string, unknown>> = {
    telegram: {
      enabled: true,
      token: '123456:ABCDEF',
      allowFrom: ['alice'],
      proxy: 'http://127.0.0.1:7890',
      groupPolicy: 'mention',
      replyToMessage: true,
    },
    discord: {
      enabled: false,
      token: '',
      allowFrom: [],
      gatewayUrl: '',
      intents: 0,
      groupPolicy: 'mention',
    },
    whatsapp: {
      enabled: true,
      bridgeUrl: 'ws://127.0.0.1:3001',
      bridgeToken: 'bind-secret',
      authDir: '',
    },
  }

  return {
    delivery: list.delivery,
    channel,
    config: configMap[channel.name] ?? { enabled: false },
  }
}

function makeChannelProbeResult(channelName = 'telegram') {
  return {
    channelName,
    status: 'passed' as const,
    statusLabel: '测试通过',
    summary: `${channelName} 渠道测试通过。`,
    detail: '最小连通性探测已通过。',
    bindingRequired: false,
    checkedAt: '2026-03-13T12:00:00Z',
    checks: [
      {
        key: 'credentials',
        label: '凭据校验',
        status: 'pass' as const,
        detail: '当前配置可用。',
      },
    ],
  }
}

function makeWhatsAppBindingStatus() {
  return {
    channelName: 'whatsapp' as const,
    bridgeUrl: 'ws://127.0.0.1:3001',
    bridgeInstalled: true,
    bridgeDir: '/tmp/nanobot-bridge',
    running: true,
    pid: 4321,
    authDir: '/tmp/nanobot-runtime/whatsapp-auth',
    authPresent: false,
    bindingRequired: true,
    listenerConnected: true,
    lastStatus: 'qr',
    lastError: null,
    qrCode: 'whatsapp://qr/mock-code',
    qrUpdatedAt: '2026-03-13T12:05:00Z',
    startedAt: '2026-03-13T12:00:00Z',
    checkedAt: '2026-03-13T12:06:00Z',
    recentLogs: ['Bridge websocket connected', 'QR code refreshed'],
  }
}

function makeMcpRegistry() {
  return {
    items: [
      {
        name: 'filesystem',
        displayName: 'Workspace Files',
        enabled: true,
        transport: 'stdio' as const,
        status: 'ready' as const,
        statusDetail: '配置结构完整，等待首次探测或运行时按需加载。',
        toolCount: 7,
        toolCountKnown: true,
        toolTimeout: 30,
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/workspace'],
        env: { MCP_API_KEY: 'secret' },
        url: null,
        headers: {},
        envCount: 1,
        headerCount: 0,
        sourceKind: 'repository' as const,
        sourceLabel: '仓库安装',
        repoUrl: 'https://github.com/modelcontextprotocol/servers',
        lastToolSyncAt: '2026-03-13T12:30:00Z',
        lastCheckedAt: '2026-03-13T12:31:00Z',
        lastProbeStatus: 'passed',
        toolNames: ['read_file', 'list_dir'],
        lastError: null,
        updatedAt: '2026-03-13T12:29:00Z',
        installDir: '/tmp/mcp-installs/modelcontextprotocol__servers',
        installMode: 'source',
        installSteps: ['npm ci'],
        requiredEnv: ['MCP_API_KEY'],
        optionalEnv: [],
        cloneUrl: 'https://github.com/modelcontextprotocol/servers.git',
      },
    ],
    summary: {
      total: 1,
      enabled: 1,
      disabled: 0,
      ready: 1,
      incomplete: 0,
      knownToolCount: 7,
      verifiedServers: 1,
    },
  }
}

function makeMcpRepairPlan() {
  return {
    generatedAt: '2026-03-13T12:55:00Z',
    serverName: 'filesystem',
    status: 'attention' as const,
    diagnosisCode: 'runtime_missing',
    diagnosisLabel: '本地运行时或路径缺失',
    summary: '看起来像是本地命令、脚本路径或安装目录丢失。',
    detail: 'spawn node ENOENT',
    missingEnv: [],
    steps: [
      {
        key: 'verify-command',
        title: '检查命令或脚本路径',
        description: '最近一次失败看起来像是找不到命令、脚本或 installDir 内的可执行文件。',
        safe: true,
      },
      {
        key: 'run-bounded-worker',
        title: '如已配置 worker，可先运行受限修复',
        description: '受限模式只会把 MCP 上下文交给外部 worker，不会自动开启危险权限。',
        safe: true,
      },
    ],
    worker: {
      configured: true,
      commandPreview: 'python repair_worker.py --server filesystem',
      dangerousAvailable: false,
    },
    run: {
      configured: true,
      running: false,
      status: 'idle' as const,
      commandPreview: 'python repair_worker.py --server filesystem',
      lastRequestedAt: null,
      lastExitCode: null,
      pid: null,
      dangerousMode: false,
      workspace: '/tmp/workspace',
    },
    entry: makeMcpRegistry().items[0],
  }
}

function makeMcpTestChat() {
  return {
    session: {
      id: 'mcp-test:filesystem',
      sessionId: 'mcp-test:filesystem',
      title: 'MCP Test · filesystem',
      createdAt: '2026-03-13T12:20:00Z',
      updatedAt: '2026-03-13T12:30:00Z',
      messageCount: 2,
    },
    messages: [
      {
        id: 'msg_1',
        sessionId: 'mcp-test:filesystem',
        sequence: 1,
        role: 'user',
        content: '请列出你能提供的工具',
        createdAt: '2026-03-13T12:20:00Z',
      },
      {
        id: 'msg_2',
        sessionId: 'mcp-test:filesystem',
        sequence: 2,
        role: 'assistant',
        content: '当前可见工具: read_file, list_dir',
        createdAt: '2026-03-13T12:20:10Z',
      },
    ],
    toolNames: ['read_file', 'list_dir'],
    recentToolActivity: [
      {
        sessionId: 'mcp-test:filesystem',
        sessionTitle: 'MCP Test · filesystem',
        toolName: 'read_file',
        source: 'tool_call',
        createdAt: '2026-03-13T12:20:08Z',
      },
    ],
  }
}

function makeValidationResult() {
  return {
    generatedAt: '2026-03-13T12:35:00Z',
    summary: {
      status: 'attention' as const,
      passed: 4,
      warnings: 1,
      failures: 0,
    },
    checks: [
      {
        key: 'provider',
        category: 'provider' as const,
        status: 'pass' as const,
        label: '模型供应商',
        summary: '模型供应商配置完整。',
        detail: '当前使用 deepseek · 模型 deepseek/deepseek-chat',
        href: '/models',
        actionLabel: '查看模型',
      },
      {
        key: 'mcp',
        category: 'mcp' as const,
        status: 'warn' as const,
        label: 'MCP 服务',
        summary: '有 MCP 仍需补齐配置或重新探测。',
        detail: '待处理: Workspace Files',
        href: '/mcp',
        actionLabel: '检查 MCP',
      },
    ],
    dangerousOptions: [
      {
        key: 'workspace-scope',
        label: '未限制到工作区',
        status: 'warn' as const,
        summary: 'Exec/Web 等能力当前不受工作区目录限制。',
        detail: '如果这是生产环境，建议启用 restrictToWorkspace 以降低误操作范围。',
        href: '/system/validation',
        actionLabel: '查看验证',
      },
    ],
  }
}

function makeCalendarEvents() {
  return [
    {
      id: 'evt-1',
      title: 'Design review',
      description: 'Walk through the web migration',
      start: '2026-03-15T09:00:00+08:00',
      end: '2026-03-15T10:00:00+08:00',
      isAllDay: false,
      priority: 'high' as const,
      reminders: [{ time: 15, channel: 'web', target: 'calendar-reminders' }],
      recurrence: null,
      recurrenceId: null,
      createdAt: '2026-03-13T09:00:00Z',
      updatedAt: '2026-03-13T09:30:00Z',
    },
  ]
}

function makeCalendarSettings() {
  return {
    defaultView: 'timeGridWeek' as const,
    defaultPriority: 'medium' as const,
    soundEnabled: true,
    notificationEnabled: true,
  }
}

function makeCalendarJobs() {
  return [
    {
      id: 'calendar:evt-1:15m',
      name: 'calendar reminder · Design review',
      enabled: true,
      source: 'calendar',
      trigger: {
        type: 'at' as const,
        dateMs: Date.now() + 60_000,
      },
      payload: {
        kind: 'calendar_reminder' as const,
        message: 'Reminder: Design review',
        deliver: false,
        to: 'calendar-reminders',
      },
      nextRunAtMs: Date.now() + 60_000,
      lastRunAtMs: null,
      lastStatus: null,
      lastError: null,
      deleteAfterRun: true,
      createdAtMs: Date.now() - 120_000,
      updatedAtMs: Date.now() - 60_000,
    },
  ]
}

function makeProfile() {
  return {
    username: 'admin',
    displayName: 'Console Owner',
    email: 'owner@example.com',
    hasAvatar: true,
    avatarUpdatedAt: '2026-03-13T12:45:00Z',
    avatarUrl: '/api/v1/profile/avatar?v=2026-03-13T12:45:00Z',
    createdAt: '2026-03-13T10:00:00Z',
    updatedAt: '2026-03-13T12:45:00Z',
  }
}

function makeDocuments() {
  return [
    {
      id: 'AGENTS.md',
      label: 'AGENTS.md',
      path: '/tmp/workspace/AGENTS.md',
      hasTemplate: true,
      updatedAt: '2026-03-13T10:05:00Z',
    },
    {
      id: 'SOUL.md',
      label: 'SOUL.md',
      path: '/tmp/workspace/SOUL.md',
      hasTemplate: true,
      updatedAt: '2026-03-13T09:55:00Z',
    },
    {
      id: 'USER.md',
      label: 'USER.md',
      path: '/tmp/workspace/USER.md',
      hasTemplate: true,
      updatedAt: '2026-03-13T09:50:00Z',
    },
    {
      id: 'TOOLS.md',
      label: 'TOOLS.md',
      path: '/tmp/workspace/TOOLS.md',
      hasTemplate: true,
      updatedAt: '2026-03-13T09:45:00Z',
    },
    {
      id: 'HEARTBEAT.md',
      label: 'HEARTBEAT.md',
      path: '/tmp/workspace/HEARTBEAT.md',
      hasTemplate: true,
      updatedAt: '2026-03-13T09:40:00Z',
    },
    {
      id: 'memory/MEMORY.md',
      label: 'MEMORY.md',
      path: '/tmp/workspace/memory/MEMORY.md',
      hasTemplate: true,
      updatedAt: '2026-03-13T09:35:00Z',
    },
    {
      id: 'memory/HISTORY.md',
      label: 'HISTORY.md',
      path: '/tmp/workspace/memory/HISTORY.md',
      hasTemplate: false,
      updatedAt: '2026-03-13T09:30:00Z',
    },
  ]
}

function makeDocument(documentId = 'AGENTS.md') {
  const relativePath = documentId.startsWith('memory/') ? documentId : documentId
  const pathSegments = documentId.split('/')
  return {
    id: documentId,
    label: documentId.startsWith('memory/') ? pathSegments[pathSegments.length - 1] || documentId : documentId,
    content: '# Agent Instructions\n\nStay concise.',
    updatedAt: '2026-03-13T10:05:00Z',
    sourcePath: `/tmp/workspace/${relativePath}`,
    hasTemplate: documentId !== 'memory/HISTORY.md',
  }
}

function makeAgentTemplates() {
  return [
    {
      name: 'coder',
      description: 'Code-oriented template',
      tools: ['read_file', 'write_file', 'list_dir'],
      rules: ['Read before editing', 'Validate your change'],
      system_prompt: 'Review the assigned task: {task}',
      skills: [],
      model: null,
      backend: 'claude_code',
      source: 'builtin',
      is_builtin: true,
      is_editable: false,
      is_deletable: false,
      enabled: true,
      created_at: '2026-03-13T08:00:00Z',
      updated_at: '2026-03-13T08:00:00Z',
    },
    {
      name: 'repo-reviewer',
      description: 'Review-oriented template',
      tools: ['read_file', 'list_dir', 'web_search'],
      rules: ['Check key files first', 'Summarize findings clearly'],
      system_prompt: 'Review this repository for the assigned task: {task}',
      skills: ['skill-creator'],
      model: 'deepseek/deepseek-chat',
      backend: null,
      source: 'user',
      is_builtin: false,
      is_editable: true,
      is_deletable: true,
      enabled: true,
      created_at: '2026-03-13T09:10:00Z',
      updated_at: '2026-03-13T09:40:00Z',
    },
  ]
}

function makeAgentTemplate() {
  return makeAgentTemplates()[1]
}

function makeValidTemplateTools() {
  return [
    { name: 'read_file', description: 'Read a file from the workspace.' },
    { name: 'write_file', description: 'Create or overwrite a file in the workspace.' },
    { name: 'list_dir', description: 'Inspect files and directories in the workspace.' },
    { name: 'web_search', description: 'Search the web for public information.' },
  ]
}

function makeOpsLogs() {
  return {
    items: [
      {
        name: 'nanobot.log',
        path: '/tmp/logs/nanobot.log',
        sizeBytes: 120,
        lineCount: 3,
        updatedAt: '2026-03-13T12:40:00Z',
        tail: ['line one', 'line two', 'line three'],
      },
    ],
  }
}

function makeOpsActions() {
  return {
    items: [
      {
        name: 'restart',
        label: '重启实例',
        configured: false,
        running: false,
        commandPreview: null,
        workspace: '/tmp/workspace',
        description: '显式调用外部重启命令，适用于受控部署或 supervisor 环境。',
        caution: '只会执行已经通过环境变量声明的命令，不会自动推断部署方式。',
        lastRequestedAt: null,
        lastStatus: 'unconfigured' as const,
        lastExitCode: null,
        pid: null,
      },
    ],
  }
}

function makeChatUpload() {
  return {
    name: 'brief.txt',
    path: '/tmp/workspace/uploads/brief.txt',
    relativePath: 'uploads/brief.txt',
    sizeBytes: 128,
    uploadedAt: '2026-03-13T12:45:00Z',
  }
}

function makeChatWorkspace() {
  return {
    generatedAt: '2026-03-13T12:46:00Z',
    runtime: {
      workspace: '/tmp/workspace',
      provider: 'deepseek',
      model: 'deepseek/deepseek-chat',
      status: 'ready' as const,
      enabledChannels: ['telegram'],
      activeMcpCount: 1,
    },
    recentUploads: [makeChatUpload()],
    recentToolActivity: makeMcpTestChat().recentToolActivity,
    activeMcp: [
      {
        name: 'filesystem',
        displayName: 'Filesystem',
        toolCount: 2,
        toolNames: ['read_file', 'list_dir'],
        status: 'connected',
      },
    ],
    quickPrompts: [
      '帮我梳理这个工作区最近的改动',
      '检查当前项目里最需要优先处理的问题',
    ],
  }
}

function renderShell() {
  installMatchMedia(true)

  return renderWithProviders(
    <MemoryRouter
      initialEntries={['/chat']}
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route path="chat" element={<div>Route body</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

function renderPage(element: JSX.Element) {
  installMatchMedia(false)
  return renderWithProviders(
    <MemoryRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      {element}
    </MemoryRouter>,
  )
}

describe('web app smoke pages', () => {
  beforeEach(() => {
    window.localStorage.clear()
    mockApi.health.mockResolvedValue({ status: 'ok' })
    mockApi.getAuthStatus.mockResolvedValue({
      initialized: true,
      authenticated: true,
      username: 'admin',
    })
    mockApi.bootstrapAuth.mockResolvedValue({
      initialized: true,
      authenticated: true,
      username: 'admin',
    })
    mockApi.getAgentTemplates.mockResolvedValue(makeAgentTemplates())
    mockApi.getAgentTemplate.mockResolvedValue(makeAgentTemplate())
    mockApi.getCalendarEvents.mockResolvedValue(makeCalendarEvents())
    mockApi.getCalendarJobs.mockResolvedValue(makeCalendarJobs())
    mockApi.getCalendarSettings.mockResolvedValue(makeCalendarSettings())
    mockApi.getChannel.mockResolvedValue(makeChannelDetail())
    mockApi.getChannels.mockResolvedValue(makeChannelsList())
    mockApi.getWhatsAppBindingStatus.mockResolvedValue(makeWhatsAppBindingStatus())
    mockApi.getDocuments.mockResolvedValue(makeDocuments())
    mockApi.getDocument.mockResolvedValue(makeDocument())
    mockApi.getMcpServers.mockResolvedValue(makeMcpRegistry())
    mockApi.getMcpServer.mockResolvedValue(makeMcpRegistry().items[0])
    mockApi.getMcpRepairPlan.mockResolvedValue(makeMcpRepairPlan())
    mockApi.getMcpTestChat.mockResolvedValue(makeMcpTestChat())
    mockApi.getProfile.mockResolvedValue(makeProfile())
    mockApi.getOpsLogs.mockResolvedValue(makeOpsLogs())
    mockApi.getOpsActions.mockResolvedValue(makeOpsActions())
    mockApi.probeMcpServer.mockResolvedValue({
      serverName: 'filesystem',
      ok: true,
      status: 'passed',
      statusLabel: '探测通过',
      toolNames: ['read_file', 'list_dir'],
      toolCount: 2,
      missingEnv: [],
      error: null,
      entry: makeMcpRegistry().items[0],
    })
    mockApi.runMcpRepair.mockResolvedValue(makeMcpRepairPlan())
    mockApi.sendMcpTestChatMessage.mockResolvedValue({
      content: '当前可见工具: read_file, list_dir',
      assistantMessage: makeMcpTestChat().messages[1],
      session: makeMcpTestChat().session,
      messages: makeMcpTestChat().messages,
      toolNames: makeMcpTestChat().toolNames,
      recentToolActivity: makeMcpTestChat().recentToolActivity,
    })
    mockApi.clearMcpTestChat.mockResolvedValue({ deleted: true })
    mockApi.setMcpServerEnabled.mockResolvedValue({
      serverName: 'filesystem',
      enabled: true,
      entry: makeMcpRegistry().items[0],
      config: makeConfig(),
    })
    mockApi.updateMcpServer.mockResolvedValue({
      serverName: 'filesystem',
      entry: makeMcpRegistry().items[0],
      config: makeConfig(),
    })
    mockApi.deleteMcpServer.mockResolvedValue({
      deleted: true,
      serverName: 'filesystem',
      checkoutRemoved: true,
      config: makeConfig(),
    })
    mockApi.updateProfile.mockResolvedValue({
      profile: makeProfile(),
      auth: {
        initialized: true,
        authenticated: true,
        username: 'admin',
      },
    })
    mockApi.rotateProfilePassword.mockResolvedValue({
      profile: makeProfile(),
      auth: {
        initialized: true,
        authenticated: true,
        username: 'admin',
      },
    })
    mockApi.uploadProfileAvatar.mockResolvedValue({
      profile: makeProfile(),
    })
    mockApi.deleteProfileAvatar.mockResolvedValue({
      profile: { ...makeProfile(), hasAvatar: false, avatarUrl: null, avatarUpdatedAt: null },
    })
    mockApi.createAgentTemplate.mockResolvedValue({
      name: 'repo-reviewer',
      success: true,
    })
    mockApi.updateAgentTemplate.mockResolvedValue({
      name: 'repo-reviewer',
      success: true,
    })
    mockApi.deleteAgentTemplate.mockResolvedValue({
      name: 'repo-reviewer',
      success: true,
    })
    mockApi.createCalendarEvent.mockResolvedValue(makeCalendarEvents()[0])
    mockApi.updateCalendarEvent.mockResolvedValue(makeCalendarEvents()[0])
    mockApi.deleteCalendarEvent.mockResolvedValue({ deleted: true })
    mockApi.uploadChatFile.mockResolvedValue(makeChatUpload())
    mockApi.triggerOpsAction.mockResolvedValue({
      item: {
        ...makeOpsActions().items[0],
        configured: true,
        commandPreview: 'supervisorctl restart nanobot',
        lastStatus: 'running' as const,
      },
    })
    mockApi.updateDocument.mockResolvedValue(makeDocument())
    mockApi.resetDocument.mockResolvedValue(makeDocument())
    mockApi.getValidTemplateTools.mockResolvedValue(makeValidTemplateTools())
    mockApi.importAgentTemplates.mockResolvedValue({
      imported: [{ name: 'repo-reviewer-imported', action: 'created' }],
      errors: [],
    })
    mockApi.exportAgentTemplates.mockResolvedValue({
      content: 'agents:\n  - name: repo-reviewer\n',
    })
    mockApi.reloadAgentTemplates.mockResolvedValue({
      success: true,
    })
    mockApi.updateCalendarSettings.mockResolvedValue(makeCalendarSettings())
    mockApi.updateChannel.mockResolvedValue(makeChannelDetail())
    mockApi.updateChannelDelivery.mockResolvedValue(makeChannelsList())
    mockApi.testChannel.mockResolvedValue(makeChannelProbeResult())
    mockApi.startWhatsAppBinding.mockResolvedValue(makeWhatsAppBindingStatus())
    mockApi.stopWhatsAppBinding.mockResolvedValue({
      ...makeWhatsAppBindingStatus(),
      running: false,
      listenerConnected: false,
      lastStatus: 'stopped',
    })
    mockApi.getSetupStatus.mockResolvedValue({
      completed: true,
      currentStep: 'done',
      completedAt: '2026-03-13T11:00:00Z',
      steps: [
        { key: 'provider', label: '模型供应商', optional: false, complete: true },
        { key: 'channel', label: '消息频道', optional: true, complete: true, skipped: true },
        { key: 'agent', label: 'Agent 默认值', optional: false, complete: true },
      ],
    })
    mockApi.login.mockResolvedValue({
      initialized: true,
      authenticated: true,
      username: 'admin',
    })
    mockApi.logout.mockResolvedValue({
      initialized: true,
      authenticated: false,
      username: null,
    })
    mockApi.updateSetupProvider.mockResolvedValue({
      config: makeConfig(),
      setup: {
        completed: false,
        currentStep: 'channel',
        completedAt: null,
        steps: [
          { key: 'provider', label: '模型供应商', optional: false, complete: true },
          { key: 'channel', label: '消息频道', optional: true, complete: false, skipped: false },
          { key: 'agent', label: 'Agent 默认值', optional: false, complete: false },
        ],
      },
    })
    mockApi.updateSetupChannel.mockResolvedValue({
      config: makeConfig(),
      setup: {
        completed: false,
        currentStep: 'agent',
        completedAt: null,
        steps: [
          { key: 'provider', label: '模型供应商', optional: false, complete: true },
          { key: 'channel', label: '消息频道', optional: true, complete: true, skipped: true },
          { key: 'agent', label: 'Agent 默认值', optional: false, complete: false },
        ],
      },
    })
    mockApi.updateSetupAgentDefaults.mockResolvedValue({
      config: makeConfig(),
      setup: {
        completed: true,
        currentStep: 'done',
        completedAt: '2026-03-13T11:20:00Z',
        steps: [
          { key: 'provider', label: '模型供应商', optional: false, complete: true },
          { key: 'channel', label: '消息频道', optional: true, complete: true, skipped: true },
          { key: 'agent', label: 'Agent 默认值', optional: false, complete: true },
        ],
      },
    })
    mockApi.getSystemStatus.mockResolvedValue(makeSystemStatus())
    mockApi.runValidation.mockResolvedValue(makeValidationResult())
    mockApi.createSession.mockResolvedValue({
      id: 'session-new',
      sessionId: 'web:session-new',
      title: '新会话',
      createdAt: '2026-03-13T10:10:00Z',
      updatedAt: '2026-03-13T10:10:00Z',
      messageCount: 0,
    })
    mockApi.renameSession.mockImplementation(async (sessionId: string, title: string) => ({
      id: sessionId,
      sessionId: `web:${sessionId}`,
      title,
      createdAt: '2026-03-13T10:00:00Z',
      updatedAt: '2026-03-13T10:06:00Z',
      messageCount: 2,
    }))
    mockApi.deleteSession.mockResolvedValue({ deleted: true })
    mockApi.getSessions.mockResolvedValue({
      items: [
        {
          id: 'session-1',
          sessionId: 'web:session-1',
          title: 'Smoke Session',
          createdAt: '2026-03-13T10:00:00Z',
          updatedAt: '2026-03-13T10:05:00Z',
          messageCount: 2,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    })
    mockApi.getMessages.mockResolvedValue([])
    mockApi.getChatWorkspace.mockResolvedValue(makeChatWorkspace())
    mockApi.getConfig.mockResolvedValue(makeConfig())
    mockApi.getConfigMeta.mockResolvedValue(makeConfigMeta())
    mockApi.getCronStatus.mockResolvedValue({
      enabled: true,
      jobs: 1,
      nextWakeAtMs: Date.now() + 60_000,
      deliveryMode: 'agent_only' as const,
    })
    mockApi.getCronJobs.mockResolvedValue({
      jobs: [
        {
          id: 'cron-1',
          name: 'daily recap',
          enabled: true,
          source: 'user',
          trigger: {
            type: 'cron' as const,
            cronExpr: '0 9 * * *',
            tz: 'Asia/Shanghai',
          },
          payload: {
            kind: 'agent_turn' as const,
            message: 'summarize the latest changes',
            deliver: false,
          },
          nextRunAtMs: Date.now() + 60_000,
          lastRunAtMs: Date.now() - 60_000,
          lastStatus: 'ok' as const,
          lastError: null,
          deleteAfterRun: false,
          createdAtMs: Date.now() - 120_000,
          updatedAtMs: Date.now() - 30_000,
        },
      ],
    })
    mockApi.getInstalledSkills.mockResolvedValue([
      {
        id: 'skill-creator',
        name: 'Skill Creator',
        description: 'Builds reusable skills.',
        source: 'builtin',
        path: '/tmp/workspace/skills/skill-creator',
        version: '1.0.0',
        author: 'nanobot',
        tags: ['skills'],
        enabled: true,
        isDeletable: false,
      },
    ])
  })

  it('renders the desktop app shell navigation', async () => {
    renderShell()

    expect(await screen.findByText('主路径')).toBeInTheDocument()
    expect(await screen.findByText('对话', { selector: '.nav-item-title' })).toBeInTheDocument()
    expect(screen.getByText('模型', { selector: '.nav-item-title' })).toBeInTheDocument()
    expect(screen.getByText('渠道', { selector: '.nav-item-title' })).toBeInTheDocument()
    expect(screen.getByText('技能', { selector: '.nav-item-title' })).toBeInTheDocument()
    expect(screen.getByText('MCP', { selector: '.nav-item-title' })).toBeInTheDocument()
    expect(screen.getByText('提示词与记忆', { selector: '.nav-item-title' })).toBeInTheDocument()
    expect(screen.getByText('系统', { selector: '.nav-item-title' })).toBeInTheDocument()
    expect(screen.queryByText('日程', { selector: '.nav-item-title' })).not.toBeInTheDocument()
    expect(screen.queryByText('定时任务', { selector: '.nav-item-title' })).not.toBeInTheDocument()
    expect(screen.queryByText('模板', { selector: '.nav-item-title' })).not.toBeInTheDocument()
    expect(screen.queryByText('验证中心', { selector: '.nav-item-title' })).not.toBeInTheDocument()
    expect(screen.queryByText('运维', { selector: '.nav-item-title' })).not.toBeInTheDocument()
    expect(screen.queryByText('资料', { selector: '.nav-item-title' })).not.toBeInTheDocument()
    expect((await screen.findAllByText('admin')).length).toBeGreaterThan(0)
  })

  it('renders validation inside the system domain', async () => {
    installMatchMedia(false)

    renderWithProviders(
      <MemoryRouter
        initialEntries={['/system/validation']}
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <Routes>
          <Route path="/system" element={<SystemLayoutPage />}>
            <Route path="validation" element={<ValidationPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('验证')).toBeInTheDocument()
    expect(screen.getByText('自动化')).toBeInTheDocument()
    expect(screen.getByText('日志与运维动作')).toBeInTheDocument()
    expect(screen.getByText('配置修复中心')).toBeInTheDocument()
  })

  it('redirects unauthenticated users to the login page', async () => {
    installMatchMedia(false)
    mockApi.getAuthStatus.mockResolvedValueOnce({
      initialized: true,
      authenticated: false,
      username: null,
    })

    renderWithProviders(
      <MemoryRouter
        initialEntries={['/chat']}
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <AppRoutes />
      </MemoryRouter>,
    )

    expect(await screen.findByText('登录到工作台')).toBeInTheDocument()
  })

  it('sends first-time users to the bootstrap page', async () => {
    installMatchMedia(false)
    mockApi.getAuthStatus.mockResolvedValueOnce({
      initialized: false,
      authenticated: false,
      username: null,
    })

    renderWithProviders(
      <MemoryRouter
        initialEntries={['/chat']}
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <AppRoutes />
      </MemoryRouter>,
    )

    expect(await screen.findByText('初始化工作台管理员')).toBeInTheDocument()
  })

  it('renders the setup wizard page', async () => {
    installMatchMedia(false)
    mockApi.getSetupStatus.mockResolvedValue({
      completed: false,
      currentStep: 'provider',
      completedAt: null,
      steps: [
        { key: 'provider', label: '模型供应商', optional: false, complete: false },
        { key: 'channel', label: '消息频道', optional: true, complete: false, skipped: false },
        { key: 'agent', label: 'Agent 默认值', optional: false, complete: false },
      ],
    })

    renderWithProviders(
      <MemoryRouter
        initialEntries={['/setup']}
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <SetupPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('先把实例接通，再放行工作台', undefined, { timeout: 3000 })).toBeInTheDocument()
  })

  it('sends authenticated users to the chat landing page', async () => {
    installMatchMedia(false)

    renderWithProviders(
      <MemoryRouter
        initialEntries={['/']}
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <AppRoutes />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Smoke Session', { selector: '.conversation-title' })).toBeInTheDocument()
  })

  it('renders the chat page', async () => {
    renderPage(<ChatPage />)
    expect(await screen.findByText('Smoke Session', { selector: '.conversation-title' })).toBeInTheDocument()
    expect(screen.getByText('拖拽文件到这里')).toBeInTheDocument()
  })

  it('renders the calendar page', async () => {
    renderPage(<CalendarPage />)
    expect(await screen.findByText('日程与提醒')).toBeInTheDocument()
    expect(screen.getByText('派生提醒任务')).toBeInTheDocument()
  })

  it('renders the cron page', async () => {
    renderPage(<CronPage />)
    expect(await screen.findByText('自动化任务')).toBeInTheDocument()
  })

  it('renders the skills page', async () => {
    renderPage(<SkillsPage />)
    expect(await screen.findByText('先从技能市场拿能力')).toBeInTheDocument()
    expect(screen.getByText('推荐路径：技能市场')).toBeInTheDocument()
    expect(screen.getByText('兜底路径：手动上传')).toBeInTheDocument()
  })

  it('renders the main prompt page', async () => {
    renderPage(<MainPromptPage />)
    expect(await screen.findByText('工作区引导与记忆')).toBeInTheDocument()
    expect(screen.getByText('工作区文件选择')).toBeInTheDocument()
    expect(screen.getByText('长期记忆')).toBeInTheDocument()
  })

  it('renders the templates page', async () => {
    renderPage(<TemplatesPage />)
    expect(await screen.findByText('Agent 模板中心')).toBeInTheDocument()
    expect(screen.getByText('导入 / 导出 / 冲突策略')).toBeInTheDocument()
  })

  it('renders the mcp page', async () => {
    renderPage(<McpPage />)
    expect(await screen.findByText('MCP 扩展目录')).toBeInTheDocument()
    expect(screen.getByText('从仓库安装')).toBeInTheDocument()
    expect(screen.getByText('MCP 目录')).toBeInTheDocument()
    expect(screen.getByText('Workspace Files')).toBeInTheDocument()
  })

  it('renders the mcp detail page', async () => {
    renderWithProviders(
      <MemoryRouter
        initialEntries={['/mcp/filesystem']}
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <Routes>
          <Route path="/mcp/:serverName" element={<McpServerDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('维护 Workspace Files')).toBeInTheDocument()
    expect(screen.getByText('连接详情')).toBeInTheDocument()
    expect(screen.getByText('修复计划')).toBeInTheDocument()
    expect(screen.getByText('隔离测试聊天')).toBeInTheDocument()
  })

  it('renders the models page', async () => {
    renderPage(<ModelsPage />)
    expect(await screen.findByText('先把默认模型接通')).toBeInTheDocument()
    expect(screen.getByText('1. 选择供应商')).toBeInTheDocument()
    expect(screen.getByText('2. 模型')).toBeInTheDocument()
  })

  it('renders the channels page', async () => {
    renderPage(<ChannelsPage />)
    expect(await screen.findByText('把聊天渠道接进实例')).toBeInTheDocument()
    expect(screen.getByText('统一投递行为')).toBeInTheDocument()
    expect(screen.getByText('Telegram')).toBeInTheDocument()
  })

  it('renders the channel detail page', async () => {
    renderWithProviders(
      <MemoryRouter
        initialEntries={['/channels/telegram']}
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <Routes>
          <Route path="/channels/:channelName" element={<ChannelDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('配置 Telegram')).toBeInTheDocument()
    expect(screen.getByText('启用状态')).toBeInTheDocument()
    expect(screen.getByText('测试')).toBeInTheDocument()
    expect(screen.getByText('接入字段')).toBeInTheDocument()
  })

  it('renders the WhatsApp binding panel on the channel detail page', async () => {
    mockApi.getChannel.mockResolvedValueOnce(makeChannelDetail('whatsapp'))
    mockApi.testChannel.mockResolvedValueOnce(makeChannelProbeResult('whatsapp'))

    renderWithProviders(
      <MemoryRouter
        initialEntries={['/channels/whatsapp']}
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <Routes>
          <Route path="/channels/:channelName" element={<ChannelDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('配置 WhatsApp')).toBeInTheDocument()
    expect(screen.getByText('绑定流程')).toBeInTheDocument()
    expect(screen.getByText('启动绑定')).toBeInTheDocument()
    expect(screen.getByText('扫描二维码完成设备绑定')).toBeInTheDocument()
  })

  it('renders the profile page', async () => {
    renderPage(<ProfilePage />)
    expect(await screen.findByText('管理员资料与安全')).toBeInTheDocument()
    expect(screen.getByText('密码轮换')).toBeInTheDocument()
  })

  it('renders the operations page', async () => {
    renderPage(<OperationsPage />)
    expect(await screen.findByText('只保留日志与运维动作')).toBeInTheDocument()
    expect(screen.getByText('运维动作')).toBeInTheDocument()
  })

  it('renders the validation page', async () => {
    renderPage(<ValidationPage />)
    expect(await screen.findByText('配置修复中心')).toBeInTheDocument()
    expect(screen.getByText('危险配置隔离区')).toBeInTheDocument()
  })

  it('renders the system page', async () => {
    renderPage(<SystemPage />)
    expect(await screen.findByText('实例健康与环境')).toBeInTheDocument()
  })
})
