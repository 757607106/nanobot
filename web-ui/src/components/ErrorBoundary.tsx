import React from 'react'
import { Result, Button, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'

const { Paragraph, Text } = Typography

export interface ErrorBoundaryProps {
  children: React.ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Uncaught error in ErrorBoundary:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', padding: '2rem' }}>
          <Result
            status="error"
            title="页面发生异常"
            subTitle="当前模块遇到未预期的运行错误，已停止渲染。"
            extra={[
              <Button key="reload" type="primary" icon={<ReloadOutlined />} onClick={() => window.location.reload()}>
                刷新页面
              </Button>,
            ]}
          >
            <div className="desc">
              <Paragraph>
                <Text strong style={{ fontSize: 'var(--nb-text-lg)' }}>错误详情</Text>
              </Paragraph>
              <Paragraph>
                <Text type="danger">{this.state.error?.message || 'Unknown Error'}</Text>
              </Paragraph>
            </div>
          </Result>
        </div>
      )
    }

    return this.props.children
  }
}
