import { Chart, Button } from '@streaik/themes';
import { chartFence, parseChartSpec } from '@streaik/themes/chart-spec';
import type { ChartSpec } from '@streaik/themes/chart-spec';
import { createContext, useContext, useId, useState } from 'react';
import type { ReactNode } from 'react';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAppTranslation } from './i18n';

const ChartMarkdown = createContext('');

function ChartBlock({ spec, code }: { spec: ChartSpec; code: ReactNode }) {
  const { t } = useAppTranslation();
  const [showCode, setShowCode] = useState(false);
  const panel = useId();
  return <div className="chat-chart-block">
    <div className="chat-chart-controls" role="group" aria-label={t('Chart view')}>
      <Button variant={showCode ? 'subtle' : 'primary'} aria-pressed={!showCode} aria-controls={panel} onClick={() => setShowCode(false)}>{t('Chart')}</Button>
      <Button variant={showCode ? 'primary' : 'subtle'} aria-pressed={showCode} aria-controls={panel} onClick={() => setShowCode(true)}>{t('Code')}</Button>
    </div>
    <div id={panel}>{showCode ? code : <Chart spec={spec} translate={t} />}</div>
  </div>;
}

// CommonMark lets an unclosed fence run to EOF, even during streaming. Check the
// source positions before replacing the pre block; react-markdown supplies the
// decoded code text (with list/quote indentation removed) separately.
const ChartPre: NonNullable<Components['pre']> = ({ node, children, ...props }) => {
  const markdown = useContext(ChartMarkdown);
  const code = node?.children[0];
  const text = code?.type === 'element' && code.tagName === 'code' &&
    Array.isArray(code.properties.className) && code.properties.className.includes(`language-${chartFence}`) && code.children[0];
  const position = node?.position;
  const source = <pre {...props}>{children}</pre>;
  if (!text || text.type !== 'text' || !position || position.start.line === position.end.line) return source;
  const start = position.start.offset;
  const end = position.end.offset;
  if (start === undefined || end === undefined) return source;
  const opening = markdown.slice(start, end).match(/^(?:`{3,}|~{3,})/u)?.[0];
  const closingLine = Math.max(markdown.lastIndexOf('\n', end - 1), markdown.lastIndexOf('\r', end - 1)) + 1;
  const closing = markdown.slice(closingLine, end).match(/^[\t >]*(`{3,}|~{3,})[\t ]*$/u)?.[1];
  if (!opening || !closing || opening[0] !== closing[0] || closing.length < opening.length) return source;
  const spec = parseChartSpec(text.value);
  return spec ? <ChartBlock spec={spec} code={source} /> : source;
};

const components = { pre: ChartPre } satisfies Components;

export default function AssistantMarkdown({ text, charts }: { text: string; charts?: boolean }) {
  return <ChartMarkdown.Provider value={charts ? text : ''}>
    <Markdown skipHtml disallowedElements={['img']} remarkPlugins={[remarkGfm]} components={charts ? components : undefined}>{text}</Markdown>
  </ChartMarkdown.Provider>;
}
