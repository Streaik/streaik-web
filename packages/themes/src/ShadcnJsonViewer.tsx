import type { JsonViewerProps } from './contract';
import { JsonViewer } from './uiarc/json-viewer/json-viewer';

export default function ShadcnJsonViewer({ value, label = 'JSON' }: JsonViewerProps) {
  return <JsonViewer className="shadcn-json-viewer" label={label} data={value} maxHeight="20rem" />;
}
