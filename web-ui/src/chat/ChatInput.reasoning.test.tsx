import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ChatInput, type ChatInputProps } from './ChatInput'

vi.mock('@ant-design/x', async () => {
  const ReactModule = await import('react')

  const Header = ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="mock-sender-header">{children}</div>
  )

  const Sender = ReactModule.forwardRef<any, any>(function MockSender(props, _ref) {
    const footer = typeof props.footer === 'function'
      ? props.footer(props.value ?? '', {
          components: {
            SendButton: ({ disabled }: { disabled?: boolean }) => (
              <button aria-label="mock-send" disabled={disabled}>send</button>
            ),
            LoadingButton: () => <button aria-label="mock-loading">loading</button>,
          },
        })
      : (props.footer ?? null)

    return (
      <div data-testid="mock-sender">
        {props.header}
        <textarea aria-label="sender" value={props.value ?? ''} onChange={() => {}} />
        {footer}
      </div>
    )
  }) as any

  Sender.Header = Header

  const Attachments = () => <div data-testid="mock-attachments" />

  return {
    Sender,
    Attachments,
  }
})

function buildProps(overrides: Partial<ChatInputProps> = {}): ChatInputProps {
  return {
    value: '',
    onChange: () => undefined,
    onSubmit: () => undefined,
    onCancel: () => undefined,
    isRequesting: false,
    uploadingFiles: false,
    assistantLabel: 'NanoCrew',
    pendingAttachments: [],
    onPendingAttachmentsChange: () => undefined,
    draftAttachmentRefs: [],
    onDraftAttachmentRefsChange: () => undefined,
    dropContainerRef: { current: null },
    isDesktopLayout: true,
    reasoningSupported: true,
    reasoningEffort: 'medium',
    onReasoningEffortChange: () => undefined,
    ...overrides,
  }
}

describe('ChatInput reasoning toggle', () => {
  it('renders reasoning toggle when reasoning is supported', () => {
    render(<ChatInput {...buildProps({ reasoningSupported: true })} />)
    expect(screen.getByText('深度思考')).toBeInTheDocument()
  })

  it('hides reasoning toggle when reasoning is not supported', () => {
    render(
      <ChatInput
        {...buildProps({
          reasoningSupported: false,
          reasoningEffort: null,
        })}
      />,
    )
    expect(screen.queryByText('深度思考')).not.toBeInTheDocument()
  })
})
