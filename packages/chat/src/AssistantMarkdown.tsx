import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function AssistantMarkdown({ text }: { text: string }) {
  return <Markdown skipHtml disallowedElements={['img']} remarkPlugins={[remarkGfm]}>{text}</Markdown>;
}
