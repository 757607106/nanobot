import { useEffect, useState } from 'react'
import { Button, Flex, Popconfirm, Space, Table, Tag, Typography } from 'antd'
import { PlusOutlined, ReloadOutlined, DeleteOutlined } from '@ant-design/icons'
import { api } from '../../api'
import PageHeader from '../../components/console/PageHeader'
import SectionCard from '../../components/console/SectionCard'
import type { Tenant } from '../../types'
import { useToast } from '../../toast'
import TenantDetailDrawer from './TenantDetailDrawer'

export default function TenantsPage() {
  const message = useToast()
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<Tenant[]>([])
  
  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null)

  useEffect(() => {
    void loadData()
  }, [])

  async function loadData() {
    try {
      setLoading(true)
      const result = await api.getTenants()
      setData(result)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  async function deleteTenant(tenantId: string) {
    try {
      await api.deleteTenant(tenantId)
      message.success('已删除租户')
      void loadData()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除失败')
    }
  }

  function openDrawer(tenantId: string | null) {
    setSelectedTenantId(tenantId)
    setDrawerOpen(true)
  }

  return (
    <Flex vertical gap={18}>
      <PageHeader
        title="多租户管理"
        actions={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void loadData()} loading={loading}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openDrawer(null)}>
              新建租户
            </Button>
          </Space>
        }
      />

      <SectionCard title="全部租户">
        <Table<Tenant>
          dataSource={data}
          rowKey="tenantId"
          loading={loading}
          pagination={false}
          columns={[
            {
              title: '名称',
              dataIndex: 'name',
              key: 'name',
              render: (text, record) => (
                <Typography.Link onClick={() => openDrawer(record.tenantId)}>
                  <Typography.Text strong>{text || '未命名租户'}</Typography.Text>
                </Typography.Link>
              ),
            },
            {
              title: '租户 ID',
              dataIndex: 'tenantId',
              key: 'tenantId',
              render: (text) => <Typography.Text type="secondary" style={{ fontFamily: 'monospace' }}>{text}</Typography.Text>,
            },
            {
              title: '状态',
              dataIndex: 'isActive',
              key: 'isActive',
              render: (val) => (
                <Tag color={val ? 'success' : 'default'} bordered={false}>
                  {val ? '正常' : '已停用'}
                </Tag>
              ),
            },
            {
              title: '创建时间',
              dataIndex: 'createdAt',
              key: 'createdAt',
              render: (val) => <span className="text-secondary">{new Date(val).toLocaleString()}</span>,
            },
            {
              title: '操作',
              key: 'action',
              width: 100,
              render: (_, record) => (
                <Popconfirm
                  title="确认删除该租户吗？"
                  description="删除后相关数据均不可恢复。"
                  onConfirm={() => void deleteTenant(record.tenantId)}
                >
                  <Button type="text" danger icon={<DeleteOutlined />} size="small" />
                </Popconfirm>
              ),
            },
          ]}
        />
      </SectionCard>

      <TenantDetailDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        tenantId={selectedTenantId}
        onSaved={() => void loadData()}
      />
    </Flex>
  )
}
