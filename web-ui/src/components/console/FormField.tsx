import type { ReactNode } from 'react'
import { Typography } from 'antd'

interface FormFieldProps {
  /** Field label */
  label: string
  /** Whether the field is required */
  required?: boolean
  /** Optional helper text below the input */
  helper?: string
  /** The form control (Input, Select, etc.) */
  children: ReactNode
  /** Span entire row in a grid layout */
  fullWidth?: boolean
}

/**
 * Consistent form field layout used across console pages.
 * Replaces the repeated pattern of:
 *   <div><Typography.Text>Label</Typography.Text><Input style={{ marginTop: 8 }} /></div>
 */
export default function FormField({
  label,
  required,
  helper,
  children,
  fullWidth,
}: FormFieldProps) {
  return (
    <div style={{ minWidth: 0, ...(fullWidth ? { gridColumn: '1 / -1' } : {}) }}>
      <Typography.Text
        type="secondary"
        style={{ display: 'block', fontSize: 'var(--nb-text-sm)', marginBottom: 8 }}
      >
        {label}
        {required ? <span style={{ color: 'var(--nb-accent)', marginLeft: 4 }}>*</span> : null}
      </Typography.Text>
      {children}
      {helper ? (
        <Typography.Text
          type="secondary"
          style={{ display: 'block', fontSize: 'var(--nb-text-xs)', marginTop: 6, lineHeight: 1.5 }}
        >
          {helper}
        </Typography.Text>
      ) : null}
    </div>
  )
}
