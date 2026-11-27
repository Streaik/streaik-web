import { Button } from '@fluentui/react-button';
import { MoreHorizontal24Regular } from '@fluentui/react-icons';
import { Menu, MenuItem, MenuList, MenuPopover, MenuTrigger } from '@fluentui/react-menu';
import { Overflow, OverflowItem, useIsOverflowItemVisible, useOverflowMenu } from '@fluentui/react-overflow';
import { Tab, TabList } from '@fluentui/react-tabs';
import { useLayoutEffect, useRef, useState } from 'react';
import type { TabItem, TabListProps } from './contract';
import { tabIndexForKey } from './tabNavigation';
import './fluentTabs.css';

function HiddenTab({ item, onSelect }: { item: TabItem; onSelect: (item: TabItem) => void }) {
  const visible = useIsOverflowItemVisible(item.id);
  return visible ? null : <MenuItem icon={item.icon} onClick={() => onSelect(item)}>{item.label}</MenuItem>;
}

function MoreTabs({ items, label, mountNode, onSelect }: {
  items: readonly TabItem[]; label: string; mountNode?: HTMLElement; onSelect: (item: TabItem) => void;
}) {
  const { ref, isOverflowing } = useOverflowMenu<HTMLButtonElement>();
  if (!isOverflowing) return null;
  return <Menu mountNode={mountNode} positioning={{ position: 'below', align: 'end', strategy: 'fixed' }}>
    <MenuTrigger disableButtonEnhancement>
      <Button ref={ref} type="button" size="small" appearance="subtle" aria-label={label} icon={<MoreHorizontal24Regular />} />
    </MenuTrigger>
    <MenuPopover><MenuList aria-label={label}>
      {items.map(item => <HiddenTab key={item.id} item={item} onSelect={onSelect} />)}
    </MenuList></MenuPopover>
  </Menu>;
}

export function FluentTabs({ label, moreLabel, items, value, onValueChange }: TabListProps) {
  const [list, setList] = useState<HTMLDivElement | null>(null);
  const pendingFocus = useRef<string | undefined>(undefined);
  function focusSelected() {
    if (!pendingFocus.current || !list) return;
    // An overflowed tab becomes focusable after Fluent remeasures and promotes it.
    requestAnimationFrame(() => {
      if (!pendingFocus.current) return;
      const target = list.ownerDocument.getElementById(pendingFocus.current);
      if (target?.getAttribute('aria-selected') !== 'true' || !target.getClientRects().length) return;
      pendingFocus.current = undefined;
      target.focus();
    });
  }
  useLayoutEffect(focusSelected, [value]);

  function selectAndFocus(item: TabItem) {
    pendingFocus.current = item.id;
    onValueChange(item.value);
    focusSelected();
  }

  return <Overflow padding={0} minimumVisible={1} onOverflowChange={focusSelected}>
    <div className="fluent-tabs-row">
      {/* Use our roving focus handler in place of Tabster's visible-tabs-only mover. */}
      <TabList ref={setList} className="fluent-tabs-list" aria-label={label} size="small" selectedValue={value} data-tabster="{}"
        onTabSelect={(_event, data) => { if (typeof data.value === 'string') onValueChange(data.value); }}
        onKeyDownCapture={event => {
          // Keep the app's automatic activation and order, even when the next tab is in More tabs.
          const tab = (event.target as HTMLElement).closest('[role="tab"]');
          const index = items.findIndex(item => item.id === tab?.id);
          if (index < 0) return;
          const next = tabIndexForKey(event.key, index, items.length);
          if (next === undefined) return;
          event.preventDefault();
          event.stopPropagation();
          selectAndFocus(items[next]);
        }}>
        {items.map(item => <OverflowItem key={item.id} id={item.id} pinned={value === item.value}>
          <Tab className="fluent-tabs-trigger" id={item.id} value={item.value} aria-controls={item.panelId}
            tabIndex={value === item.value ? 0 : -1} icon={item.icon}>{item.label}</Tab>
        </OverflowItem>)}
      </TabList>
      <MoreTabs items={items} label={moreLabel} mountNode={list?.closest('dialog') ?? undefined} onSelect={selectAndFocus} />
    </div>
  </Overflow>;
}
