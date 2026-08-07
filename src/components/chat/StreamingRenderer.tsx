import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './StreamingRenderer.css'

interface StreamingRendererProps {
  content: string
}

function StreamingRendererComponent({ content }: StreamingRendererProps) {
  return (
    <div className="md-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}

export const StreamingRenderer = memo(StreamingRendererComponent)
