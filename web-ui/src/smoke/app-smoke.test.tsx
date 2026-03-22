import { fireEvent, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockApi = vi.hoisted(() => ({
  createSession: vi.fn(),
  applyMemoryCandidate: vi.fn(),
  createAgent: vi.fn(),
  createTeam: vi.fn(),
  createCalendarEvent: vi.fn(),
  createKnowledgeBase: vi.fn(),
  copyAgent: vi.fn(),
  copyTeam: vi.fn(),
  deleteAgent: vi.fn(),
  deleteTeam: vi.fn(),
  deleteKnowledgeBase: vi.fn(),
  deleteKnowledgeDocument: vi.fn(),
  deleteSession: vi.fn(),
  health: vi.fn(),
  getAgent: vi.fn(),
  getAgents: vi.fn(),
  getAuthStatus: vi.fn(),
  bootstrapAuth: vi.fn(),
  getChatWorkspace: vi.fn(),
  getSessionFiles: vi.fn(),
  getCalendarEvents: vi.fn(),
  getCalendarJobs: vi.fn(),
  getCalendarSettings: vi.fn(),
  getChannel: vi.fn(),
  getChannels: vi.fn(),
  getKnowledgeBase: vi.fn(),
  getKnowledgeBases: vi.fn(),
  getKnowledgeFiles: vi.fn(),
  getKnowledgeFileDetail: vi.fn(),
  getKnowledgeSources: vi.fn(),
  getKnowledgeQueryParamSchema: vi.fn(),
  getKnowledgeSampleQuestions: vi.fn(),
  getKnowledgeMindmap: vi.fn(),
  getKnowledgeGraphStats: vi.fn(),
  getKnowledgeBenchmarks: vi.fn(),
  getKnowledgeEvaluationHistory: vi.fn(),
  getMemoryCandidates: vi.fn(),
  getMemorySource: vi.fn(),
  getTeam: vi.fn(),
  getTeamThread: vi.fn(),
  getTeamThreadMessages: vi.fn(),
  getTeamMemory: vi.fn(),
  getTeams: vi.fn(),
  getKnowledgeDocuments: vi.fn(),
  getKnowledgeJobs: vi.fn(),
  getWhatsAppBindingStatus: vi.fn(),
  testChannel: vi.fn(),
  getMcpServer: vi.fn(),
  getMcpServers: vi.fn(),
  getMcpRepairPlan: vi.fn(),
  getMcpTestChat: vi.fn(),
  getOpsActions: vi.fn(),
  getOpsLogs: vi.fn(),
  getProfile: vi.fn(),
  searchMarketplaceSkills: vi.fn(),
  searchMemory: vi.fn(),
  getSetupStatus: vi.fn(),
  probeMcpServer: vi.fn(),
  rejectMemoryCandidate: vi.fn(),
  runMcpRepair: vi.fn(),
  sendMcpTestChatMessage: vi.fn(),
  clearMcpTestChat: vi.fn(),
  cancelRun: vi.fn(),
  runValidation: vi.fn(),
  runTeam: vi.fn(),
  setMcpServerEnabled: vi.fn(),
  rotateProfilePassword: vi.fn(),
  triggerOpsAction: vi.fn(),
  uploadSessionChatFile: vi.fn(),
  uploadProfileAvatar: vi.fn(),
  deleteProfileAvatar: vi.fn(),
  updateProfile: vi.fn(),
  updateMcpServer: vi.fn(),
  deleteMcpServer: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  getSessions: vi.fn(),
  getMessages: vi.fn(),
  getConfig: vi.fn(),
  getConfigMeta: vi.fn(),
  getRun: vi.fn(),
  getRunArtifact: vi.fn(),
  getRunTree: vi.fn(),
  getRunChildren: vi.fn(),
  getSystemStatus: vi.fn(),
  getRuns: vi.fn(),
  getCronStatus: vi.fn(),
  getCronJobs: vi.fn(),
  getInstalledSkills: vi.fn(),
  getValidTemplateTools: vi.fn(),
  renameSession: vi.fn(),
  retryTeamRun: vi.fn(),
  retrieveKnowledgeBase: vi.fn(),
  reindexKnowledgeBase: vi.fn(),
  installMarketplaceSkill: vi.fn(),
  importSessionFiles: vi.fn(),
  testRunAgent: vi.fn(),
  uploadKnowledgeDocuments: vi.fn(),
  uploadSkillZip: vi.fn(),
  updateAgent: vi.fn(),
  updateTeam: vi.fn(),
  updateKnowledgeBase: vi.fn(),
  updateTeamMemory: vi.fn(),
  updateConfig: vi.fn(),
  updateCalendarEvent: vi.fn(),
  updateCalendarSettings: vi.fn(),
  updateChannel: vi.fn(),
  updateChannelDelivery: vi.fn(),
  startWhatsAppBinding: vi.fn(),
  stopWhatsAppBinding: vi.fn(),
  addKnowledgeSource: vi.fn(),
  getChannelBindings: vi.fn(),
  getChannelBinding: vi.fn(),
  createChannelBinding: vi.fn(),
  updateChannelBinding: vi.fn(),
  deleteChannelBinding: vi.fn(),
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

  const icons: Record<string, ReturnType<typeof makeIcon>> = {
    ApiOutlined: makeIcon('api'),
    ApartmentOutlined: makeIcon('apartment'),
    AppstoreOutlined: makeIcon('appstore'),
    ArrowLeftOutlined: makeIcon('arrow-left'),
    BookOutlined: makeIcon('book'),
    CalendarOutlined: makeIcon('calendar'),
    CheckCircleOutlined: makeIcon('check-circle'),
    ClockCircleOutlined: makeIcon('clock'),
    ClusterOutlined: makeIcon('cluster'),
    CodeOutlined: makeIcon('code'),
    DeleteOutlined: makeIcon('delete'),
    DesktopOutlined: makeIcon('desktop'),
    DatabaseOutlined: makeIcon('database'),
    CloudDownloadOutlined: makeIcon('cloud-download'),
    DownloadOutlined: makeIcon('download'),
    EditOutlined: makeIcon('edit'),
    ExperimentOutlined: makeIcon('experiment'),
    EyeOutlined: makeIcon('eye'),
    FileTextOutlined: makeIcon('file-text'),
    FolderOpenOutlined: makeIcon('folder-open'),
    GlobalOutlined: makeIcon('global'),
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
    CopyOutlined: makeIcon('copy'),
    ProfileOutlined: makeIcon('profile'),
    ReloadOutlined: makeIcon('reload'),
    RobotOutlined: makeIcon('robot'),
    SaveOutlined: makeIcon('save'),
    SearchOutlined: makeIcon('search'),
    SettingOutlined: makeIcon('setting'),
    SunOutlined: makeIcon('sun'),
    TeamOutlined: makeIcon('team'),
    ToolOutlined: makeIcon('tool'),
    UploadOutlined: makeIcon('upload'),
    UserOutlined: makeIcon('user'),
    CloudUploadOutlined: makeIcon('cloud-upload'),
  }

  return new Proxy(icons, {
    get(target, prop) {
      if (typeof prop !== 'string') {
        return undefined
      }
      if (prop === 'then') {
        return undefined
      }
      if (!(prop in target)) {
        target[prop] = makeIcon(prop)
      }
      return target[prop]
    },
  })
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

  const Card = Object.assign(
    ({ title, extra, children, actions, className, onClick }: Props) => (
      <section className={className} onClick={onClick}>
        {title}
        {extra}
        {children}
        {actions?.map((action, index) => <div key={index}>{action}</div>)}
      </section>
    ),
    {
      Meta: ({ title, description }: Props) => (
        <div>
          <div>{title}</div>
          <div>{description}</div>
        </div>
      ),
    },
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
  const SearchInput = React.forwardRef<HTMLInputElement, Props>((props, ref) => {
    const { className, disabled, onChange, onSearch, placeholder, value } = props as {
      className?: string
      disabled?: boolean
      onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
      onSearch?: (value: string) => void
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
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            onSearch?.(String(value ?? ''))
          }
        }}
      />
    )
  })
  SearchInput.displayName = 'MockInputSearch'

  const Input = Object.assign(InputBase, {
    Password: PasswordInput,
    Search: SearchInput,
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

  const AutoComplete = ({ className, disabled, onChange, placeholder, value }: Props) => (
    <input
      className={className}
      disabled={Boolean(disabled)}
      placeholder={typeof placeholder === 'string' ? placeholder : undefined}
      value={typeof value === 'string' || typeof value === 'number' ? value : undefined}
      onChange={(event) => onChange?.(event.target.value)}
    />
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

  const Checkbox = ({ checked, className, disabled, onChange, children }: Props) => (
    <label className={className}>
      <input
        type="checkbox"
        disabled={Boolean(disabled)}
        checked={Boolean(checked)}
        onChange={(event) => onChange?.(event)}
      />
      {children}
    </label>
  )

  const Segmented = ({ options = [] }: Props) => (
    <div>
      {options.map((option, index) => (
        <span key={index}>{(option as { label: React.ReactNode }).label}</span>
      ))}
    </div>
  )

  const Tabs = ({ items = [], onChange }: Props) => (
    <div>
      {items.map((item, index) => (
        <section key={item.key ?? index}>
          <button type="button" onClick={() => onChange?.(item.key)}>
            {item.label as React.ReactNode}
          </button>
          <div>{item.children as React.ReactNode}</div>
        </section>
      ))}
    </div>
  )

  const Collapse = ({ items = [] }: Props) => (
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
  const Badge = ({ children, text }: Props & { text?: React.ReactNode }) => (
    <span>
      {text as React.ReactNode}
      {children}
    </span>
  )
  const Descriptions = Object.assign(
    ({ children }: Props) => <dl>{children}</dl>,
    {
      Item: ({ children, label }: Props) => (
        <div>
          <dt>{label}</dt>
          <dd>{children}</dd>
        </div>
      ),
    },
  )
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

  const Skeleton = ({
    title,
    paragraph,
  }: Props & {
    title?: { width?: React.CSSProperties['width'] } | boolean
    paragraph?: { rows?: number } | boolean
  }) => (
    <div>
      {title ? <div data-skeleton-title>{typeof title === 'object' ? String(title.width ?? '') : 'title'}</div> : null}
      {paragraph ? <div data-skeleton-paragraph>{typeof paragraph === 'object' ? paragraph.rows ?? 0 : 0}</div> : null}
    </div>
  )
  const Spin = () => <div>loading</div>
  const Statistic = ({ title, value }: Props & { title?: React.ReactNode; value?: React.ReactNode }) => (
    <div>
      <div>{title}</div>
      <div>{value}</div>
    </div>
  )

  const Typography = {
    Title: ({ children }: Props) => <div>{children}</div>,
    Paragraph: ({ children }: Props) => <p>{children}</p>,
    Text: ({ children }: Props) => <span>{children}</span>,
  }

  const Space = Object.assign(Box, {
    Compact: Box,
  })
  const Row = Box
  const Col = Box
  const Flex = Box

  const List = Object.assign(
    ({ dataSource = [], renderItem }: Props & { dataSource?: unknown[]; renderItem?: (item: unknown) => React.ReactNode }) => (
      <div>{dataSource.map((item, index) => <div key={index}>{renderItem?.(item)}</div>)}</div>
    ),
    {
      Item: Object.assign(
        ({ children }: Props) => <div>{children}</div>,
        {
          Meta: ({
            avatar,
            description,
            title,
          }: Props & { avatar?: React.ReactNode; description?: React.ReactNode; title?: React.ReactNode }) => (
            <div>
              {avatar as React.ReactNode}
              {title as React.ReactNode}
              {description as React.ReactNode}
            </div>
          ),
        },
      ),
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

  const UploadBase = ({ children, className }: Props) => <div className={className}>{children}</div>
  const Upload = Object.assign(UploadBase, {
    Dragger: UploadBase,
  })

  const Table = ({
    columns = [],
    dataSource = [],
  }: Props & {
    columns?: Array<{
      dataIndex?: string
      key?: string
      render?: (value: unknown, record: unknown, index: number) => React.ReactNode
      title?: React.ReactNode
    }>
    dataSource?: unknown[]
  }) => (
    <table>
      <thead>
        <tr>
          {columns.map((column, index) => (
            <th key={String((column as { key?: string }).key ?? index)}>
              {(column as { title?: React.ReactNode }).title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {dataSource.map((record, rowIndex) => (
          <tr key={String((record as { key?: string }).key ?? rowIndex)}>
            {columns.map((column, columnIndex) => {
              const key = (column as { dataIndex?: string; key?: string }).dataIndex
              const render = (column as { render?: (value: unknown, record: unknown, index: number) => React.ReactNode }).render
              const value = key && typeof record === 'object' && record !== null ? (record as Record<string, unknown>)[key] : undefined
              return (
                <td key={`${rowIndex}-${String((column as { key?: string }).key ?? columnIndex)}`}>
                  {render ? render(value, record, rowIndex) : (value as React.ReactNode)}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )

  const Steps = ({ items = [] }: Props) => (
    <ol>
      {items.map((item, index) => (
        <li key={(item as { key?: string }).key ?? index}>
          {(item as { icon?: React.ReactNode }).icon}
          {(item as { title?: React.ReactNode }).title}
          {(item as { description?: React.ReactNode }).description}
        </li>
      ))}
    </ol>
  )

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
      xs: window.matchMedia('(min-width: 480px)').matches,
      sm: window.matchMedia('(min-width: 576px)').matches,
      md: window.matchMedia('(min-width: 768px)').matches,
      lg: window.matchMedia('(min-width: 992px)').matches,
      xl: window.matchMedia('(min-width: 1200px)').matches,
      xxl: window.matchMedia('(min-width: 1600px)').matches,
    }),
  }

  const ConfigProvider = ({ children }: React.PropsWithChildren) => <>{children}</>

  return {
    Alert,
    App: AppProvider,
    Badge,
    Button,
    Card,
    Checkbox,
    Col,
    Collapse,
    ConfigProvider,
    Descriptions,
    Divider,
    Drawer,
    Empty,
    Flex,
    Form,
    Grid,
    Input,
    InputNumber,
    AutoComplete,
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
    Skeleton,
    Space,
    Spin,
    Statistic,
    Steps,
    Switch,
    Table,
    Tabs,
    Tag,
    Tooltip,
    Typography,
    Upload,
  }
})

import { AppRoutes } from '../App'
import AppShell from '../components/AppShell'
import CalendarPage from '../pages/CalendarPage'
import ChannelBindingsPage from '../pages/ChannelBindingsPage'
import ChannelDetailPage from '../pages/ChannelDetailPage'
import ChannelsLayoutPage from '../pages/ChannelsLayoutPage'
import ChannelsPage from '../pages/ChannelsPage'
import ChatPage from '../pages/ChatPage'
import DashboardPage from '../pages/DashboardPage'
import CronPage from '../pages/CronPage'
import McpPage from '../pages/McpPage'
import McpServerDetailPage from '../pages/McpServerDetailPage'
import ModelsPage from '../pages/ModelsPage'
import OperationsPage from '../pages/OperationsPage'
import ProfilePage from '../pages/ProfilePage'
import AgentsPage from '../pages/AgentsPage'
import KnowledgePage from '../pages/KnowledgePage'
import MemoryAuditPage from '../pages/MemoryAuditPage'
import RunsPage from '../pages/RunsPage'
import SkillsPage from '../pages/SkillsPage'
import SetupPage from '../pages/SetupPage'
import StudioLayoutPage from '../pages/StudioLayoutPage'
import SystemLayoutPage from '../pages/SystemLayoutPage'
import SystemPage from '../pages/SystemPage'
import TeamsPage from '../pages/TeamsPage'
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
        binding: 'deepseek-default',
        provider: 'deepseek',
        maxTokens: 4096,
        contextWindowTokens: 128000,
        temperature: 0.7,
        maxToolIterations: 12,
        reasoningEffort: 'medium',
      },
    },
    modelBindings: {
      'deepseek-default': {
        provider: 'deepseek',
        label: 'DeepSeek 默认',
        model: 'deepseek/deepseek-chat',
        apiKey: 'sk-test',
        apiBase: 'https://api.deepseek.com',
        extraHeaders: {},
      },
      'openai-embedding': {
        provider: 'openai',
        label: 'OpenAI Embedding',
        model: 'text-embedding-3-large',
        capabilityType: 'embedding',
        apiKey: 'sk-openai',
        apiBase: 'https://api.openai.com/v1',
        extraHeaders: {},
      },
    },
    providers: {
      deepseek: {
        apiKey: 'sk-test',
        apiBase: 'https://api.deepseek.com',
        extraHeaders: {},
      },
      openai: {
        apiKey: 'sk-openai',
        apiBase: 'https://api.openai.com/v1',
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
    rag: {
      llmBinding: 'deepseek-default',
      embeddingBinding: 'openai-embedding',
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
        name: 'openai',
        label: 'OpenAI',
        category: 'direct' as const,
        keywords: ['openai'],
        defaultApiBase: 'https://api.openai.com/v1',
        supportsPromptCaching: false,
        isGateway: false,
        isLocal: false,
        isOauth: false,
        isDirect: true,
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
    qq: {
      enabled: true,
      appId: '1900000001',
      secret: 'qq-secret',
      allowFrom: ['*'],
      msgFormat: 'markdown',
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

function makeAgents() {
  return [
    {
      agentId: 'support-lead',
      tenantId: 'default',
      instanceId: 'instance-default',
      name: 'Support Lead',
      description: 'Coordinate support response quality.',
      systemPrompt: 'Coordinate the support team.',
      rules: ['Route work clearly'],
      model: 'deepseek/deepseek-chat',
      backend: null,
      enabled: true,
      toolAllowlist: ['read_file'],
      mcpServerIds: [],
      skillIds: [],
      knowledgeBindingIds: ['support-kb'],
      tags: ['support'],
      memoryScope: 'agent_profile',
      sourceTemplateName: null,
      createdAt: '2026-03-14T09:00:00Z',
      updatedAt: '2026-03-14T09:00:00Z',
    },
    {
      agentId: 'support-member',
      tenantId: 'default',
      instanceId: 'instance-default',
      name: 'Support Member',
      description: 'Prepare support-ready drafts.',
      systemPrompt: 'Handle assigned support tasks.',
      rules: ['Ground answers in knowledge'],
      model: 'deepseek/deepseek-chat',
      backend: null,
      enabled: true,
      toolAllowlist: ['read_file'],
      mcpServerIds: [],
      skillIds: [],
      knowledgeBindingIds: ['support-kb'],
      tags: ['support'],
      memoryScope: 'agent_profile',
      sourceTemplateName: null,
      createdAt: '2026-03-14T09:05:00Z',
      updatedAt: '2026-03-14T09:05:00Z',
    },
  ]
}

function makeTeams() {
  return [
    {
      teamId: 'support-team',
      tenantId: 'default',
      instanceId: 'instance-default',
      name: 'Support Team',
      description: 'Coordinate support replies and QA.',
      supervisorAgentId: 'support-lead',
      memberAgentIds: ['support-member'],
      sharedKnowledgeBindingIds: ['support-kb'],
      memberAccessPolicy: {
        teamSharedKnowledge: 'members_read',
        teamSharedMemory: 'leader_write_member_read',
      },
      tags: ['support'],
      enabled: true,
      memberCount: 2,
      createdAt: '2026-03-14T09:10:00Z',
      updatedAt: '2026-03-14T09:10:00Z',
    },
  ]
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
      resolvedProvider: 'deepseek',
      resolvedBinding: 'deepseek-default',
      model: 'deepseek/deepseek-chat',
      reasoningEffort: 'medium',
      maxToolIterations: 24,
      restrictToWorkspace: true,
      sendProgress: true,
      sendToolHints: false,
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
      initialEntries={['/dashboard']}
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route path="dashboard" element={<div>Route body</div>} />
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
    mockApi.getAgents.mockResolvedValue(makeAgents())
    mockApi.getAgent.mockResolvedValue(makeAgents()[0])
    mockApi.getCalendarEvents.mockResolvedValue(makeCalendarEvents())
    mockApi.getCalendarJobs.mockResolvedValue(makeCalendarJobs())
    mockApi.getCalendarSettings.mockResolvedValue(makeCalendarSettings())
    mockApi.getChannel.mockResolvedValue(makeChannelDetail())
    mockApi.getChannels.mockResolvedValue(makeChannelsList())
    mockApi.getChannelBindings.mockResolvedValue([{
      bindingId: 'cb-test-001',
      tenantId: 'default',
      instanceId: 'instance-default',
      channelName: 'telegram',
      channelChatId: '*',
      targetType: 'agent',
      targetId: 'support-lead',
      priority: 0,
      enabled: true,
      metadata: {},
      createdAt: '2026-03-14T10:00:00Z',
      updatedAt: '2026-03-14T10:00:00Z',
    }])
    mockApi.getChannelBinding.mockResolvedValue({
      bindingId: 'cb-test-001',
      tenantId: 'default',
      instanceId: 'instance-default',
      channelName: 'telegram',
      channelChatId: '*',
      targetType: 'agent',
      targetId: 'support-lead',
      priority: 0,
      enabled: true,
      metadata: {},
      createdAt: '2026-03-14T10:00:00Z',
      updatedAt: '2026-03-14T10:00:00Z',
    })
    mockApi.createChannelBinding.mockResolvedValue({
      bindingId: 'cb-test-002',
      tenantId: 'default',
      instanceId: 'instance-default',
      channelName: 'discord',
      channelChatId: '*',
      targetType: 'team',
      targetId: 'support-team',
      priority: 0,
      enabled: true,
      metadata: {},
      createdAt: '2026-03-14T10:05:00Z',
      updatedAt: '2026-03-14T10:05:00Z',
    })
    mockApi.updateChannelBinding.mockResolvedValue({
      bindingId: 'cb-test-001',
      tenantId: 'default',
      instanceId: 'instance-default',
      channelName: 'telegram',
      channelChatId: '*',
      targetType: 'agent',
      targetId: 'support-lead',
      priority: 1,
      enabled: true,
      metadata: {},
      createdAt: '2026-03-14T10:00:00Z',
      updatedAt: '2026-03-14T10:06:00Z',
    })
    mockApi.deleteChannelBinding.mockResolvedValue({ deleted: true })
    mockApi.getKnowledgeBases.mockResolvedValue([
      {
        kbId: 'support-kb',
        dbId: 'support-kb',
        tenantId: 'default',
        instanceId: 'instance-default',
        name: 'Support KB',
        description: 'Customer support knowledge base',
        enabled: true,
        kbType: 'lightrag',
        embedInfo: {},
        llmInfo: {},
        queryParams: {
          mode: 'hybrid',
          topK: 8,
          chunkTopK: 8,
          responseType: 'Multiple Paragraphs',
          onlyNeedContext: false,
          onlyNeedPrompt: false,
          enableRerank: false,
          rerankModel: null,
          options: {},
        },
        tags: ['support'],
        retrievalProfile: {
          mode: 'hybrid',
          topK: 8,
          chunkTopK: 8,
          responseType: 'Multiple Paragraphs',
          onlyNeedContext: false,
          onlyNeedPrompt: false,
          enableRerank: false,
          rerankModel: null,
          chunkSize: 800,
          chunkOverlap: 120,
          citationRequired: true,
          vlmEnhanced: false,
          metadataFilters: {},
          options: {},
        },
        additionalParams: {},
        shareConfig: {},
        sampleQuestions: ['如何重启 worker？'],
        stats: {
          totalCount: 1,
          folderCount: 0,
          fileCount: 1,
          indexedCount: 1,
          parsedCount: 1,
          errorCount: 0,
        },
      },
    ])
    mockApi.getKnowledgeBase.mockResolvedValue({
      kbId: 'support-kb',
      dbId: 'support-kb',
      tenantId: 'default',
      instanceId: 'instance-default',
      name: 'Support KB',
      description: 'Customer support knowledge base',
      enabled: true,
      kbType: 'lightrag',
      embedInfo: {},
      llmInfo: {},
      queryParams: {
        mode: 'hybrid',
        topK: 8,
        chunkTopK: 8,
        responseType: 'Multiple Paragraphs',
        onlyNeedContext: false,
        onlyNeedPrompt: false,
        enableRerank: false,
        rerankModel: null,
        options: {},
      },
      tags: ['support'],
      retrievalProfile: {
        mode: 'hybrid',
        topK: 8,
        chunkTopK: 8,
        responseType: 'Multiple Paragraphs',
        onlyNeedContext: false,
        onlyNeedPrompt: false,
        enableRerank: false,
        rerankModel: null,
        chunkSize: 800,
        chunkOverlap: 120,
        citationRequired: true,
        vlmEnhanced: false,
        metadataFilters: {},
        options: {},
      },
      additionalParams: {},
      shareConfig: {},
      sampleQuestions: ['如何重启 worker？'],
      stats: {
        totalCount: 1,
        folderCount: 0,
        fileCount: 1,
        indexedCount: 1,
        parsedCount: 1,
        errorCount: 0,
      },
    })
    mockApi.getKnowledgeFiles.mockResolvedValue({
      items: [
        {
          fileId: 'file_support_runbook',
          docId: 'doc_support_runbook',
          kbId: 'support-kb',
          dbId: 'support-kb',
          tenantId: 'default',
          instanceId: 'instance-default',
          filename: 'worker-runbook.md',
          title: 'Worker Runbook',
          fileType: 'markdown',
          path: '/worker-runbook.md',
          status: 'indexed',
          docStatus: 'indexed',
          fileSize: 2048,
          chunkCount: 4,
          processingParams: {},
          metadata: {},
          isFolder: false,
        },
      ],
      stats: {
        totalCount: 1,
        folderCount: 0,
        fileCount: 1,
        indexedCount: 1,
        parsedCount: 1,
        errorCount: 0,
      },
    })
    mockApi.getKnowledgeFileDetail.mockResolvedValue({
      file: {
        fileId: 'file_support_runbook',
        docId: 'doc_support_runbook',
        kbId: 'support-kb',
        dbId: 'support-kb',
        tenantId: 'default',
        instanceId: 'instance-default',
        filename: 'worker-runbook.md',
        title: 'Worker Runbook',
        fileType: 'markdown',
        path: '/worker-runbook.md',
        status: 'indexed',
        docStatus: 'indexed',
        fileSize: 2048,
        chunkCount: 4,
        processingParams: {},
        metadata: {},
        isFolder: false,
      },
      content: '# Worker Runbook',
      chunks: [],
      chunkCount: 0,
    })
    mockApi.getKnowledgeQueryParamSchema.mockResolvedValue(null)
    mockApi.getKnowledgeSampleQuestions.mockResolvedValue({ questions: ['如何重启 worker？'] })
    mockApi.getKnowledgeGraphStats.mockResolvedValue(null)
    mockApi.getKnowledgeMindmap.mockRejectedValue(new Error('mindmap not configured'))
    mockApi.getKnowledgeBenchmarks.mockResolvedValue([])
    mockApi.getKnowledgeEvaluationHistory.mockResolvedValue([])
    mockApi.getKnowledgeDocuments.mockResolvedValue([])
    mockApi.getKnowledgeSources.mockResolvedValue([
      {
        sourceId: 'src_support_url',
        kbId: 'support-kb',
        tenantId: 'default',
        instanceId: 'instance-default',
        sourceType: 'web_url',
        title: 'Support Help Center',
        enabled: true,
        sourceUri: 'https://example.com/help/worker-restart',
        latestDocId: 'doc_support_url',
        syncCount: 2,
        lastSyncedAt: '2026-03-14T10:20:00Z',
        config: {
          url: 'https://example.com/help/worker-restart',
          title: 'Support Help Center',
        },
        docCount: 1,
        syncSupported: true,
        latestDocument: {
          docId: 'doc_support_url',
          kbId: 'support-kb',
          tenantId: 'default',
          instanceId: 'instance-default',
          sourceId: 'src_support_url',
          sourceType: 'web_url',
          title: 'Support Help Center',
          sourceUri: 'https://example.com/help/worker-restart',
          docStatus: 'indexed',
          chunkCount: 4,
          metadata: {},
          createdAt: '2026-03-14T10:18:00Z',
          updatedAt: '2026-03-14T10:20:00Z',
        },
        latestJob: {
          jobId: 'job_support_url',
          tenantId: 'default',
          instanceId: 'instance-default',
          kbId: 'support-kb',
          docId: 'doc_support_url',
          status: 'succeeded',
          trackId: 'track_support_url',
          createdAt: '2026-03-14T10:18:00Z',
          updatedAt: '2026-03-14T10:20:00Z',
        },
        createdAt: '2026-03-14T10:18:00Z',
        updatedAt: '2026-03-14T10:20:00Z',
      },
    ])
    mockApi.getKnowledgeJobs.mockResolvedValue([])
    mockApi.getTeams.mockResolvedValue(makeTeams())
    mockApi.getTeam.mockResolvedValue(makeTeams()[0])
    mockApi.getTeamThread.mockResolvedValue({
      threadId: 'team-thread:support-team',
      session: {
        id: 'team-thread:support-team',
        sessionId: 'team-thread:support-team',
        title: 'Team Thread · Support Team',
        createdAt: '2026-03-14T10:09:00Z',
        updatedAt: '2026-03-14T10:12:00Z',
        messageCount: 4,
      },
    })
    mockApi.getTeamThreadMessages.mockResolvedValue({
      threadId: 'team-thread:support-team',
      total: 4,
      messages: [
        {
          id: 'msg_1',
          sessionId: 'team-thread:support-team',
          sequence: 1,
          role: 'user',
          content: 'Initial support request',
          createdAt: '2026-03-14T10:09:00Z',
        },
        {
          id: 'msg_2',
          sessionId: 'team-thread:support-team',
          sequence: 2,
          role: 'assistant',
          content: 'First team summary',
          createdAt: '2026-03-14T10:09:10Z',
        },
      ],
    })
    mockApi.getTeamMemory.mockResolvedValue({
      teamId: 'support-team',
      content: 'Triage first, then summarize impact and next actions clearly.',
      fileName: 'support-team.md',
      candidateCount: 1,
      updatedAt: '2026-03-14T10:10:00Z',
    })
    mockApi.updateTeamMemory.mockResolvedValue({
      teamId: 'support-team',
      content: 'Triage first, then summarize impact and next actions clearly.',
      fileName: 'support-team.md',
      candidateCount: 1,
      updatedAt: '2026-03-14T10:10:00Z',
    })
    mockApi.getMemoryCandidates.mockResolvedValue({
      total: 1,
      items: [
        {
          candidateId: 'memcand_1',
          tenantId: 'default',
          instanceId: 'instance-default',
          scope: 'team_shared',
          sourceKind: 'member_result',
          title: 'Support Team · Research memory',
          content: 'Always confirm region and customer impact before escalation.',
          teamId: 'support-team',
          agentId: 'reviewer-agent',
          runId: 'run_team_1',
          status: 'proposed',
          createdAt: '2026-03-14T10:11:00Z',
          updatedAt: '2026-03-14T10:11:00Z',
          appliedAt: null,
        },
      ],
    })
    mockApi.applyMemoryCandidate.mockResolvedValue({
      candidateId: 'memcand_1',
      tenantId: 'default',
      instanceId: 'instance-default',
      scope: 'team_shared',
      sourceKind: 'member_result',
      title: 'Support Team · Research memory',
      content: 'Always confirm region and customer impact before escalation.',
      teamId: 'support-team',
      agentId: 'reviewer-agent',
      runId: 'run_team_1',
      status: 'applied',
      createdAt: '2026-03-14T10:11:00Z',
      updatedAt: '2026-03-14T10:12:00Z',
      appliedAt: '2026-03-14T10:12:00Z',
    })
    mockApi.rejectMemoryCandidate.mockResolvedValue({
      candidateId: 'memcand_1',
      tenantId: 'default',
      instanceId: 'instance-default',
      scope: 'team_shared',
      sourceKind: 'member_result',
      title: 'Support Team · Research memory',
      content: 'Always confirm region and customer impact before escalation.',
      teamId: 'support-team',
      agentId: 'reviewer-agent',
      runId: 'run_team_1',
      status: 'rejected',
      createdAt: '2026-03-14T10:11:00Z',
      updatedAt: '2026-03-14T10:12:00Z',
      appliedAt: null,
    })
    mockApi.searchMemory.mockResolvedValue({
      query: 'impact',
      total: 1,
      items: [
        {
          sourceType: 'team_memory',
          sourceId: 'support-team',
          title: 'Team Shared Memory · support-team',
          content: 'Triage first, then summarize impact and next actions clearly.',
          preview: 'Triage first, then summarize impact and next actions clearly.',
          score: 2,
          metadata: {},
        },
      ],
    })
    mockApi.getMemorySource.mockResolvedValue({
      sourceType: 'team_memory',
      sourceId: 'support-team',
      title: 'Team Shared Memory · support-team',
      content: 'Triage first, then summarize impact and next actions clearly.',
      metadata: {},
    })
    mockApi.getRuns.mockResolvedValue({
      items: [
        {
          runId: 'run_123',
          tenantId: 'default',
          instanceId: 'instance-default',
          kind: 'agent',
          status: 'succeeded',
          label: 'Support KB validation',
          taskPreview: 'Check the support knowledge base response quality.',
          agentId: 'support-agent',
          teamId: null,
          threadId: null,
          parentRunId: null,
          rootRunId: 'run_123',
          sessionKey: 'web:run-session',
          originChannel: 'web',
          originChatId: 'run-session',
          spawnDepth: 0,
          controlScope: 'top_level',
          workspacePath: '/tmp/workspace',
          memoryScope: 'agent_profile',
          knowledgeScope: 'support-kb',
          resultSummary: {
            content: 'Knowledge retrieval completed successfully.',
            metadata: {},
            toolsUsed: [],
          },
          childrenCount: 1,
          createdAt: '2026-03-14T10:00:00Z',
          startedAt: '2026-03-14T10:00:02Z',
          finishedAt: '2026-03-14T10:00:06Z',
          lastErrorCode: null,
          lastErrorMessage: null,
          artifactPath: 'run_123.md',
        },
      ],
      total: 1,
    })
    mockApi.getRun.mockResolvedValue({
      runId: 'run_123',
      tenantId: 'default',
      instanceId: 'instance-default',
      kind: 'agent',
      status: 'succeeded',
      label: 'Support KB validation',
      taskPreview: 'Check the support knowledge base response quality.',
      agentId: 'support-agent',
      teamId: null,
      threadId: null,
      parentRunId: null,
      rootRunId: 'run_123',
      sessionKey: 'web:run-session',
      originChannel: 'web',
      originChatId: 'run-session',
      spawnDepth: 0,
      controlScope: 'top_level',
      workspacePath: '/tmp/workspace',
      memoryScope: 'agent_profile',
      knowledgeScope: 'support-kb',
      resultSummary: {
        content: 'Knowledge retrieval completed successfully.',
        metadata: {},
        toolsUsed: [],
      },
      childrenCount: 1,
      createdAt: '2026-03-14T10:00:00Z',
      startedAt: '2026-03-14T10:00:02Z',
      finishedAt: '2026-03-14T10:00:06Z',
      lastErrorCode: null,
      lastErrorMessage: null,
      artifactPath: 'run_123.md',
      events: [
        {
          runId: 'run_123',
          eventType: 'queued',
          payload: { label: 'Support KB validation' },
          createdAt: '2026-03-14T10:00:00Z',
        },
        {
          runId: 'run_123',
          eventType: 'completed',
          payload: { artifactPath: 'run_123.md' },
          createdAt: '2026-03-14T10:00:06Z',
        },
      ],
    })
    mockApi.getRunArtifact.mockResolvedValue({
      runId: 'run_123',
      artifactPath: 'run_123.md',
      fileName: 'run_123.md',
      contentType: 'text/markdown',
      content: '# Run Artifact\n\nKnowledge retrieval completed successfully.\n',
    })
    mockApi.getRunTree.mockResolvedValue({
      runId: 'run_123',
      tenantId: 'default',
      instanceId: 'instance-default',
      kind: 'agent',
      status: 'succeeded',
      label: 'Support KB validation',
      taskPreview: 'Check the support knowledge base response quality.',
      agentId: 'support-agent',
      teamId: null,
      threadId: null,
      parentRunId: null,
      rootRunId: 'run_123',
      sessionKey: 'web:run-session',
      originChannel: 'web',
      originChatId: 'run-session',
      spawnDepth: 0,
      controlScope: 'top_level',
      workspacePath: '/tmp/workspace',
      memoryScope: 'agent_profile',
      knowledgeScope: 'support-kb',
      resultSummary: {
        content: 'Knowledge retrieval completed successfully.',
        metadata: {},
        toolsUsed: [],
      },
      childrenCount: 1,
      createdAt: '2026-03-14T10:00:00Z',
      startedAt: '2026-03-14T10:00:02Z',
      finishedAt: '2026-03-14T10:00:06Z',
      lastErrorCode: null,
      lastErrorMessage: null,
      artifactPath: 'run_123.md',
      children: [
        {
          runId: 'run_child_1',
          tenantId: 'default',
          instanceId: 'instance-default',
          kind: 'subagent',
          status: 'succeeded',
          label: 'Retrieve support chunks',
          taskPreview: 'Collect supporting chunks from the KB.',
          agentId: 'support-agent',
          teamId: null,
          threadId: null,
          parentRunId: 'run_123',
          rootRunId: 'run_123',
          sessionKey: 'web:run-session',
          originChannel: 'web',
          originChatId: 'run-session',
          spawnDepth: 1,
          controlScope: 'child',
          workspacePath: '/tmp/workspace',
          memoryScope: 'agent_profile',
          knowledgeScope: 'support-kb',
          resultSummary: {
            content: 'Collected relevant knowledge chunks.',
            metadata: {},
            toolsUsed: [],
          },
          childrenCount: 0,
          createdAt: '2026-03-14T10:00:03Z',
          startedAt: '2026-03-14T10:00:03Z',
          finishedAt: '2026-03-14T10:00:05Z',
          lastErrorCode: null,
          lastErrorMessage: null,
          artifactPath: null,
          children: [],
        },
      ],
    })
    mockApi.getRunChildren.mockResolvedValue({
      items: [
        {
          runId: 'run_child_1',
          tenantId: 'default',
          instanceId: 'instance-default',
          kind: 'subagent',
          status: 'succeeded',
          label: 'Retrieve support chunks',
          taskPreview: 'Collect supporting chunks from the KB.',
          agentId: 'support-agent',
          teamId: null,
          threadId: null,
          parentRunId: 'run_123',
          rootRunId: 'run_123',
          sessionKey: 'web:run-session',
          originChannel: 'web',
          originChatId: 'run-session',
          spawnDepth: 1,
          controlScope: 'child',
          workspacePath: '/tmp/workspace',
          memoryScope: 'agent_profile',
          knowledgeScope: 'support-kb',
          resultSummary: {
            content: 'Collected relevant knowledge chunks.',
            metadata: {},
            toolsUsed: [],
          },
          childrenCount: 0,
          createdAt: '2026-03-14T10:00:03Z',
          startedAt: '2026-03-14T10:00:03Z',
          finishedAt: '2026-03-14T10:00:05Z',
          lastErrorCode: null,
          lastErrorMessage: null,
          artifactPath: null,
        },
      ],
      total: 1,
    })
    mockApi.cancelRun.mockResolvedValue({
      runId: 'run_123',
      tenantId: 'default',
      instanceId: 'instance-default',
      kind: 'agent',
      status: 'cancel_requested',
      label: 'Support KB validation',
      taskPreview: 'Check the support knowledge base response quality.',
      agentId: 'support-agent',
      teamId: null,
      threadId: null,
      parentRunId: null,
      rootRunId: 'run_123',
      sessionKey: 'web:run-session',
      originChannel: 'web',
      originChatId: 'run-session',
      spawnDepth: 0,
      controlScope: 'top_level',
      workspacePath: '/tmp/workspace',
      memoryScope: 'agent_profile',
      knowledgeScope: 'support-kb',
      resultSummary: {
        content: 'Knowledge retrieval completed successfully.',
        metadata: {},
        toolsUsed: [],
      },
      childrenCount: 1,
      createdAt: '2026-03-14T10:00:00Z',
      startedAt: '2026-03-14T10:00:02Z',
      finishedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      artifactPath: null,
      taskCancellationSent: true,
    })
    mockApi.createKnowledgeBase.mockResolvedValue({
      kbId: 'support-kb',
      tenantId: 'default',
      instanceId: 'instance-default',
      name: 'Support KB',
      description: 'Customer support knowledge base',
      enabled: true,
      tags: ['support'],
      retrievalProfile: {
        mode: 'hybrid',
        topK: 8,
        chunkSize: 800,
        chunkOverlap: 120,
        citationRequired: true,
        vlmEnhanced: false,
        metadataFilters: {},
      },
    })
    mockApi.updateKnowledgeBase.mockResolvedValue({
      kbId: 'support-kb',
      tenantId: 'default',
      instanceId: 'instance-default',
      name: 'Support KB',
      description: 'Customer support knowledge base',
      enabled: true,
      tags: ['support'],
      retrievalProfile: {
        mode: 'hybrid',
        topK: 8,
        chunkSize: 800,
        chunkOverlap: 120,
        citationRequired: true,
        vlmEnhanced: false,
        metadataFilters: {},
      },
    })
    mockApi.deleteKnowledgeBase.mockResolvedValue({ deleted: true })
    mockApi.createAgent.mockResolvedValue(makeAgents()[0])
    mockApi.updateAgent.mockResolvedValue(makeAgents()[0])
    mockApi.copyAgent.mockResolvedValue({
      ...makeAgents()[0],
      agentId: 'support-lead-copy',
      name: 'Support Lead Copy',
    })
    mockApi.deleteAgent.mockResolvedValue({ deleted: true })
    mockApi.createTeam.mockResolvedValue(makeTeams()[0])
    mockApi.updateTeam.mockResolvedValue(makeTeams()[0])
    mockApi.copyTeam.mockResolvedValue({
      ...makeTeams()[0],
      teamId: 'support-team-copy',
      name: 'Support Team Copy',
    })
    mockApi.deleteTeam.mockResolvedValue({ deleted: true })
    mockApi.runTeam.mockResolvedValue({
      team: makeTeams()[0],
      run: {
        runId: 'team_run_1',
        tenantId: 'default',
        instanceId: 'instance-default',
        kind: 'team',
        status: 'succeeded',
        label: 'Support Team',
        taskPreview: 'Coordinate support reply quality.',
        agentId: null,
        teamId: 'support-team',
        threadId: null,
        parentRunId: null,
        rootRunId: 'team_run_1',
        sessionKey: 'team-test:support-team:team_run_1',
        originChannel: 'web',
        originChatId: 'support-team',
        spawnDepth: 0,
        controlScope: 'top_level',
        workspacePath: '/tmp/workspace',
        memoryScope: 'team_thread',
        knowledgeScope: 'team_bindings',
        resultSummary: {
          content: 'Final support summary ready for the operator.',
          metadata: {},
          toolsUsed: [],
        },
        childrenCount: 3,
        createdAt: '2026-03-14T10:10:00Z',
        startedAt: '2026-03-14T10:10:01Z',
        finishedAt: '2026-03-14T10:10:08Z',
        lastErrorCode: null,
        lastErrorMessage: null,
        artifactPath: null,
      },
      supervisorRun: {
        ...makeTeams()[0],
      } as any,
      memberRuns: [],
      finalAssistantMessage: {
        role: 'assistant',
        content: 'Final support summary ready for the operator.',
      },
      teamKnowledgeHits: [],
    })
    mockApi.retryTeamRun.mockResolvedValue({
      team: makeTeams()[0],
      run: {
        runId: 'team_run_retry_1',
        tenantId: 'default',
        instanceId: 'instance-default',
        kind: 'team',
        status: 'queued',
        label: 'Support Team',
        taskPreview: 'Coordinate support reply quality.',
        agentId: null,
        teamId: 'support-team',
        threadId: null,
        parentRunId: null,
        rootRunId: 'team_run_retry_1',
        sessionKey: 'team-test:support-team:team_run_retry_1',
        originChannel: 'web',
        originChatId: 'support-team',
        spawnDepth: 0,
        controlScope: 'top_level',
        workspacePath: '/tmp/workspace',
        memoryScope: 'team_thread',
        knowledgeScope: 'team_bindings',
        resultSummary: null,
        childrenCount: 0,
        createdAt: '2026-03-14T10:12:00Z',
        startedAt: null,
        finishedAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        artifactPath: null,
      },
      supervisorRun: null,
      memberRuns: [],
      finalAssistantMessage: null,
      teamKnowledgeHits: [],
    })
    mockApi.deleteKnowledgeDocument.mockResolvedValue({ deleted: true })
    mockApi.uploadKnowledgeDocuments.mockResolvedValue({ documents: [], jobs: [] })
    mockApi.addKnowledgeSource.mockResolvedValue({ documents: [], jobs: [] })
    mockApi.reindexKnowledgeBase.mockResolvedValue({ documents: [], jobs: [] })
    mockApi.retrieveKnowledgeBase.mockResolvedValue({
      hits: [],
      requestedMode: 'hybrid',
      effectiveMode: 'keyword',
      filters: {},
    })
    mockApi.getWhatsAppBindingStatus.mockResolvedValue(makeWhatsAppBindingStatus())
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
    mockApi.createCalendarEvent.mockResolvedValue(makeCalendarEvents()[0])
    mockApi.updateCalendarEvent.mockResolvedValue(makeCalendarEvents()[0])
    mockApi.deleteCalendarEvent.mockResolvedValue({ deleted: true })
    mockApi.getSessionFiles.mockResolvedValue([makeChatUpload()])
    mockApi.uploadSessionChatFile.mockResolvedValue({
      uploadedFile: makeChatUpload(),
      sessionFiles: [makeChatUpload()],
    })
    mockApi.importSessionFiles.mockResolvedValue({
      sessionFiles: [makeChatUpload()],
    })
    mockApi.triggerOpsAction.mockResolvedValue({
      item: {
        ...makeOpsActions().items[0],
        configured: true,
        commandPreview: 'supervisorctl restart nanobot',
        lastStatus: 'running' as const,
      },
    })
    mockApi.getValidTemplateTools.mockResolvedValue(makeValidTemplateTools())
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
    mockApi.searchMarketplaceSkills.mockResolvedValue({
      skills: [
        {
          id: 'frontend-design',
          slug: 'frontend-design',
          name: 'frontend-design',
          description: 'Create distinctive production-grade frontend interfaces.',
          source: 'skillhub',
          version: '1.0.0',
          tags: ['design'],
          homepage: 'https://skillhub.tencent.com/',
          compatibility: 'native',
          compatibilityLabel: '原生可用',
          compatibilitySummary: '包含标准 `SKILL.md`，可以被 nanobot 技能加载器识别。',
          compatibilityReasons: [
            '包含标准 `SKILL.md`，可以被 nanobot 技能加载器识别。',
            '未发现 OpenClaw、Claude 或 Codex 专属 hooks、目录约定或 `sessions_*` 依赖。',
          ],
        },
      ],
      total: 1,
    })
    mockApi.installMarketplaceSkill.mockResolvedValue({
      id: 'frontend-design',
      name: 'frontend-design',
      description: 'Create distinctive production-grade frontend interfaces.',
      source: 'workspace',
      path: '/tmp/workspace/skills/frontend-design',
      version: '1.0.0',
      author: 'SkillHub',
      tags: ['design'],
      enabled: true,
      isDeletable: true,
    })
    mockApi.uploadSkillZip.mockResolvedValue({
      id: 'zip-skill',
      name: 'zip-skill',
      description: 'ZIP uploaded skill.',
      source: 'workspace',
      path: '/tmp/workspace/skills/zip-skill',
      version: '1.0.0',
      author: 'SkillHub',
      tags: ['zip'],
      enabled: true,
      isDeletable: true,
    })
  })

  it('renders the desktop app shell navigation', async () => {
    renderShell()

    expect((await screen.findAllByText('工作区')).length).toBeGreaterThan(0)
    expect(await screen.findByText('看板', { selector: '.nav-item-title' })).toBeInTheDocument()
    expect(await screen.findByText('对话', { selector: '.nav-item-title' })).toBeInTheDocument()
    expect(screen.getByText('协作', { selector: '.nav-item-title' })).toBeInTheDocument()
    expect(screen.getByText('模型', { selector: '.nav-item-title' })).toBeInTheDocument()
    expect(screen.getByText('渠道', { selector: '.nav-item-title' })).toBeInTheDocument()
    expect(screen.getByText('技能', { selector: '.nav-item-title' })).toBeInTheDocument()
    expect(screen.getByText('连接', { selector: '.nav-item-title' })).toBeInTheDocument()
    expect(screen.getByText('知识库', { selector: '.nav-item-title' })).toBeInTheDocument()
    expect(screen.getByText('系统', { selector: '.nav-item-title' })).toBeInTheDocument()
    expect(screen.queryByText('日程', { selector: '.nav-item-title' })).not.toBeInTheDocument()
    expect(screen.queryByText('定时任务', { selector: '.nav-item-title' })).not.toBeInTheDocument()
    expect(screen.queryByText('行为引导', { selector: '.nav-item-title' })).not.toBeInTheDocument()
    expect(screen.queryByText('模板', { selector: '.nav-item-title' })).not.toBeInTheDocument()
    expect(screen.queryByText('验证中心', { selector: '.nav-item-title' })).not.toBeInTheDocument()
    expect(screen.queryByText('运维', { selector: '.nav-item-title' })).not.toBeInTheDocument()
    expect(screen.queryByText('资料', { selector: '.nav-item-title' })).not.toBeInTheDocument()
    expect((await screen.findAllByText('admin')).length).toBeGreaterThan(0)
  })

  it('renders collaboration tabs inside the studio domain', async () => {
    installMatchMedia(true)

    renderWithProviders(
      <MemoryRouter
        initialEntries={['/studio/teams']}
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <Routes>
          <Route path="/studio" element={<StudioLayoutPage />}>
            <Route path="teams" element={<div>Teams Placeholder</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('AI 员工')).toBeInTheDocument()
    expect(screen.getByText('团队')).toBeInTheDocument()
    expect(screen.queryByText('渠道绑定')).not.toBeInTheDocument()
    expect(screen.queryByText('记忆')).not.toBeInTheDocument()
    expect(screen.getByText('执行记录')).toBeInTheDocument()
    expect(screen.queryByText('知识库')).not.toBeInTheDocument()
    expect(screen.queryByText('模板')).not.toBeInTheDocument()
  })

  it('opens the agent create drawer on /studio/agents/new', async () => {
    installMatchMedia(false)

    renderWithProviders(
      <MemoryRouter
        initialEntries={['/studio/agents/new']}
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <Routes>
          <Route path="/studio/agents/new" element={<AgentsPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByPlaceholderText('输入员工名称')).toBeInTheDocument()
    expect(screen.getByText('保存员工')).toBeInTheDocument()
    expect(screen.getByText('员工试运行')).toBeInTheDocument()
  })

  it('opens the team create drawer on /studio/teams/new', async () => {
    installMatchMedia(false)

    renderWithProviders(
      <MemoryRouter
        initialEntries={['/studio/teams/new']}
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <Routes>
          <Route path="/studio/teams/new" element={<TeamsPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('保存团队')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('输入团队名称')).toBeInTheDocument()
  })

  it('renders memory audit page with candidate and search panels', async () => {
    installMatchMedia(false)

    renderWithProviders(
      <MemoryRouter
        initialEntries={['/studio/memory/support-team']}
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <Routes>
          <Route path="/studio/memory/:teamId" element={<MemoryAuditPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('团队记忆审计')).toBeInTheDocument()
    expect((await screen.findAllByText('Support Team')).length).toBeGreaterThan(0)
    expect(screen.getByText('最近对话')).toBeInTheDocument()

    fireEvent.click(screen.getByText('候选审核'))
    expect(await screen.findByText('候选记录')).toBeInTheDocument()

    fireEvent.click(screen.getByText('检索取证'))
    expect(await screen.findByText('记忆检索')).toBeInTheDocument()
  })

  it('renders knowledge page with catalog and retrieval panels', async () => {
    installMatchMedia(false)

    renderWithProviders(
      <MemoryRouter
        initialEntries={['/knowledge']}
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <Routes>
          <Route path="/knowledge" element={<KnowledgePage />} />
          <Route path="/knowledge/:kbId" element={<KnowledgePage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('知识库列表')).toBeInTheDocument()
    expect(screen.getAllByText('Support KB').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByText('Support KB'))
    expect(await screen.findByText('返回列表')).toBeInTheDocument()
    expect(screen.getAllByText('Support KB').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '文件' })).toBeInTheDocument()
    expect(screen.getByText('检索测试')).toBeInTheDocument()
    expect(screen.getByText('知识导图')).toBeInTheDocument()

    fireEvent.click(screen.getByText('设置'))
    expect(await screen.findByText('分块策略')).toBeInTheDocument()
    expect(screen.getByText('保存知识库设置')).toBeInTheDocument()
  })

  it('renders teams page with catalog and team run panels', async () => {
    installMatchMedia(false)

    renderWithProviders(
      <MemoryRouter
        initialEntries={['/studio/teams/support-team']}
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <Routes>
          <Route path="/studio/teams/:teamId" element={<TeamsPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('所有协作团队')).toBeInTheDocument()
    expect(screen.getAllByText('团队配置').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Support Team').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByText('团队运行'))
    expect(await screen.findByText('团队对话')).toBeInTheDocument()
    expect(screen.getByText('团队试运行')).toBeInTheDocument()

    fireEvent.click(screen.getByText('团队记忆'))
    expect(await screen.findByText('记忆候选')).toBeInTheDocument()
    expect(screen.getByText('保存团队记忆')).toBeInTheDocument()
  })

  it('renders channel bindings page with list and form', async () => {
    installMatchMedia(false)

    renderWithProviders(
      <MemoryRouter
        initialEntries={['/channels/bindings/cb-test-001']}
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <Routes>
          <Route path="/channels/bindings/:bindingId" element={<ChannelBindingsPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('消息路由')).toBeInTheDocument()
    expect(screen.getByText('绑定列表')).toBeInTheDocument()
    expect(screen.getAllByText('telegram').length).toBeGreaterThan(0)
  })

  it('renders runs page with detail and timeline panels', async () => {
    installMatchMedia(false)

    renderWithProviders(
      <MemoryRouter
        initialEntries={['/studio/runs/run_123']}
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <Routes>
          <Route path="/studio/runs/:runId" element={<RunsPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('执行记录')).toBeInTheDocument()
    expect(screen.getByText('执行结果')).toBeInTheDocument()
    expect(screen.getByText('执行过程')).toBeInTheDocument()
    expect(screen.getByText('任务层级结构')).toBeInTheDocument()
    expect(screen.getByText('任务产出归档')).toBeInTheDocument()
    expect(screen.getAllByText('Support KB validation').length).toBeGreaterThan(0)
  })

  it('renders validation inside the system domain', async () => {
    installMatchMedia(true)
    window.localStorage.setItem('nanobot-dev-mode', 'on')

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

    expect(await screen.findByText('配置验证')).toBeInTheDocument()
    expect(screen.getByText('自动化任务')).toBeInTheDocument()
    expect(screen.getByText('运维中心')).toBeInTheDocument()
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

    expect(await screen.findByText('登录并继续')).toBeInTheDocument()
    expect(screen.getByText('账号')).toBeInTheDocument()
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

    expect(await screen.findByText('创建管理员并进入工作台')).toBeInTheDocument()
    expect(screen.getByText('设置密码')).toBeInTheDocument()
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

    expect(await screen.findByText('欢迎使用 Nanobot', undefined, { timeout: 3000 })).toBeInTheDocument()
  })

  it('sends authenticated users to the dashboard landing page', async () => {
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

    expect(await screen.findByText('渠道概览')).toBeInTheDocument()
    expect(screen.getByText('自动化状态')).toBeInTheDocument()
  })

  it('falls back to the dashboard landing page when a hidden route is requested', async () => {
    installMatchMedia(false)

    let resolveAuthStatus!: (value: {
      initialized: boolean
      authenticated: boolean
      username: string | null
    }) => void
    mockApi.getAuthStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAuthStatus = resolve as typeof resolveAuthStatus
        }),
    )

    renderWithProviders(
      <MemoryRouter
        initialEntries={['/prompt']}
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <AppRoutes />
      </MemoryRouter>,
    )

    expect(screen.queryByText('登录并继续')).not.toBeInTheDocument()

    resolveAuthStatus({
      initialized: true,
      authenticated: true,
      username: 'admin',
    })

    expect(await screen.findByText('渠道概览')).toBeInTheDocument()
    expect(screen.queryByText('登录并继续')).not.toBeInTheDocument()
  })

  it('renders the dashboard page', async () => {
    renderPage(<DashboardPage />)
    expect(await screen.findByText('渠道概览')).toBeInTheDocument()
    expect(screen.getByText('技能概览')).toBeInTheDocument()
    expect(screen.getByText('自动化状态')).toBeInTheDocument()
    expect(screen.getByText('系统总览')).toBeInTheDocument()
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
    expect(await screen.findByText('定时任务')).toBeInTheDocument()
    expect(screen.getByText('新建任务')).toBeInTheDocument()
  })

  it('renders the skills page', async () => {
    renderPage(<SkillsPage />)
    expect(await screen.findByText('技能中心')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('搜索 SkillHub 市场...')).toBeInTheDocument()
    expect(screen.getByText('上传 ZIP')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /已安装技能/ })).toBeInTheDocument()
    expect(screen.getByText('原生可用')).toBeInTheDocument()
    expect(screen.getByText('SkillHub 官网')).toBeInTheDocument()
  })

  it('renders the mcp page', async () => {
    renderPage(<McpPage />)
    expect(await screen.findByText('MCP 服务器')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导入配置' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加 MCP 服务器' })).toBeInTheDocument()
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
    expect(await screen.findByText('配置 Workspace Files')).toBeInTheDocument()
    expect(screen.getByText('连接配置')).toBeInTheDocument()
    expect(screen.getByText('当前可用工具')).toBeInTheDocument()
    expect(screen.getByText('read_file')).toBeInTheDocument()
  })

  it('renders the models page', async () => {
    renderPage(<ModelsPage />)
    expect(await screen.findByText('模型供应商')).toBeInTheDocument()
    expect(screen.getByText('保存所有配置')).toBeInTheDocument()
    expect(screen.getByText('DeepSeek')).toBeInTheDocument()
    fireEvent.click(screen.getByText('DeepSeek'))
    expect(await screen.findByText('云端供应商全局凭据')).toBeInTheDocument()
    expect(screen.getByText('已注册模型')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /添加模型/i })).toBeInTheDocument()
    expect(screen.getAllByText('模型供应商').length).toBeGreaterThan(0)
  })

  it('renders the channels page', async () => {
    renderPage(<ChannelsPage />)
    expect(await screen.findByText('消息投递设置')).toBeInTheDocument()
    expect(screen.getByText('保存设置')).toBeInTheDocument()
    expect(screen.getByText('Telegram')).toBeInTheDocument()
  })

  it('renders channels tabs inside the channels domain', async () => {
    installMatchMedia(true)

    renderWithProviders(
      <MemoryRouter
        initialEntries={['/channels/list']}
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <Routes>
          <Route path="/channels" element={<ChannelsLayoutPage />}>
            <Route path="list" element={<div>Channels Placeholder</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('渠道管理')).toBeInTheDocument()
    expect(screen.getByText('消息路由')).toBeInTheDocument()
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
    expect(screen.getAllByText('当前状态').length).toBeGreaterThan(0)
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
    expect(screen.getByText('扫码完成绑定')).toBeInTheDocument()
  })

  it('renders the QQ markdown option on the channel detail page', async () => {
    mockApi.getChannel.mockResolvedValueOnce(makeChannelDetail('qq'))

    renderWithProviders(
      <MemoryRouter
        initialEntries={['/channels/qq']}
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

    expect(await screen.findByText('配置 QQ')).toBeInTheDocument()
    expect(screen.getByText('消息格式')).toBeInTheDocument()
    expect(screen.getByText('Markdown（推荐）')).toBeInTheDocument()
  })

  it('renders the profile page', async () => {
    renderPage(<ProfilePage />)
    expect(await screen.findByText('账户管理')).toBeInTheDocument()
    expect(screen.getByText('头像管理')).toBeInTheDocument()
  })

  it('renders the operations page', async () => {
    renderPage(<OperationsPage />)
    expect(await screen.findByText('日志与运维')).toBeInTheDocument()
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
