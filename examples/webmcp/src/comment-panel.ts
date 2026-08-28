import { featureLabel } from './feature-picker.js';
import { icon } from './icons.js';
import type { PendingMapComment, PendingMapCommentStore } from './comment-targets.js';

export interface CommentPanelOptions {
  readonly store: PendingMapCommentStore;
  readonly onLocate: (selectionId: string) => void;
  readonly onUpdate: (selectionId: string, comment: string) => string | undefined;
  readonly onRemove: (selectionId: string) => void;
  readonly onSubmitAll: () => void;
  readonly signal: AbortSignal;
}

export interface CommentPanelView {
  readonly element: HTMLElement;
  render(): void;
  showDigest(text: string): void;
  destroy(): void;
}

const SCOPE_LABELS: Record<PendingMapComment['scope'], string> = {
  feature: '要素',
  'property-class': '属性类',
  layer: '图层',
};

const iconButton = (name: Parameters<typeof icon>[0], label: string): HTMLButtonElement => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-btn';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.append(icon(name, 14));
  return button;
};

export const createCommentPanel = (options: CommentPanelOptions): CommentPanelView => {
  const root = document.createElement('aside');
  root.className = 'comment-panel';
  root.dataset.testid = 'comment-panel';
  root.setAttribute('aria-label', '待处理地图评论');

  let editingId: string | undefined;
  let destroyed = false;

  const render = (): void => {
    if (destroyed) return;
    const pending = options.store.list().filter((comment) => !options.store.isSubmitted(comment.selectionId));
    if (editingId !== undefined && !pending.some((comment) => comment.selectionId === editingId)) editingId = undefined;

    root.replaceChildren();
    const header = document.createElement('header');
    header.className = 'panel-header';
    header.append(icon('message-square-plus', 16));
    const title = document.createElement('h2');
    title.textContent = '地图评论';
    const count = document.createElement('span');
    count.className = 'panel-count';
    count.textContent = String(pending.length);
    header.append(title, count);
    root.append(header);

    if (pending.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'panel-empty';
      empty.textContent = '暂无待处理评论。开启「添加评论」模式后点击地图即可添加。';
      root.append(empty);
    } else {
      const list = document.createElement('ul');
      list.className = 'comment-list';
      for (const comment of pending) list.append(renderItem(comment));
      root.append(list);
    }

    const footer = document.createElement('footer');
    footer.className = 'panel-footer';
    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'btn-primary';
    submit.dataset.testid = 'submit-all-comments';
    submit.disabled = pending.length === 0;
    submit.append(icon('send', 15));
    submit.append(document.createTextNode(pending.length === 0 ? '提交给 ChatGPT' : `提交 ${pending.length} 条给 ChatGPT`));
    submit.addEventListener('click', () => { options.onSubmitAll(); });
    footer.append(submit);
    root.append(footer);
  };

  const renderItem = (comment: PendingMapComment): HTMLLIElement => {
    const item = document.createElement('li');
    item.className = 'comment-item';
    item.dataset.selectionId = comment.selectionId;

    const topRow = document.createElement('div');
    topRow.className = 'comment-item-top';
    const locate = document.createElement('button');
    locate.type = 'button';
    locate.className = 'comment-locate';
    locate.append(icon('map-pin', 13));
    locate.append(document.createTextNode(featureLabel(comment.feature)));
    locate.addEventListener('click', () => { options.onLocate(comment.selectionId); });
    const scope = document.createElement('span');
    scope.className = 'scope-badge';
    scope.textContent = SCOPE_LABELS[comment.scope];
    topRow.append(locate, scope);
    item.append(topRow);

    if (editingId === comment.selectionId) {
      const textarea = document.createElement('textarea');
      textarea.className = 'comment-edit-input';
      textarea.value = comment.comment;
      textarea.maxLength = 1_001;
      textarea.setAttribute('aria-label', '编辑评论内容');
      const error = document.createElement('p');
      error.className = 'comment-edit-error';
      error.setAttribute('role', 'alert');
      error.hidden = true;
      const actions = document.createElement('div');
      actions.className = 'comment-item-actions';
      const save = iconButton('check', '保存评论');
      save.addEventListener('click', () => {
        const failure = options.onUpdate(comment.selectionId, textarea.value);
        if (failure === undefined) {
          editingId = undefined;
          render();
        } else {
          error.textContent = failure;
          error.hidden = false;
        }
      });
      const cancelEdit = iconButton('x', '放弃修改');
      cancelEdit.addEventListener('click', () => { editingId = undefined; render(); });
      actions.append(save, cancelEdit);
      item.append(textarea, error, actions);
      queueMicrotask(() => { textarea.focus(); textarea.select(); });
      return item;
    }

    const snippet = document.createElement('p');
    snippet.className = 'comment-snippet';
    snippet.textContent = comment.comment;
    const actions = document.createElement('div');
    actions.className = 'comment-item-actions';
    const edit = iconButton('pencil', `编辑评论 ${comment.selectionId}`);
    edit.addEventListener('click', () => { editingId = comment.selectionId; render(); });
    const remove = iconButton('trash-2', `删除评论 ${comment.selectionId}`);
    remove.addEventListener('click', () => { options.onRemove(comment.selectionId); });
    actions.append(edit, remove);
    item.append(snippet, actions);
    return item;
  };

  const showDigest = (text: string): void => {
    if (destroyed) return;
    root.querySelector('.submitted-digest')?.remove();
    const section = document.createElement('section');
    section.className = 'submitted-digest';
    const heading = document.createElement('h3');
    heading.append(icon('check', 14));
    heading.append(document.createTextNode('已提交给 ChatGPT'));
    const hint = document.createElement('p');
    hint.className = 'digest-hint';
    hint.textContent = '摘要已自动选中并复制到剪贴板。接下来直接在 ChatGPT 中说明处理要求即可，站点工具会读取全部已提交评论；页面本身不会执行任何地图修改。';
    const digestText = document.createElement('div');
    digestText.className = 'digest-text';
    digestText.dataset.testid = 'submitted-digest';
    digestText.textContent = text;
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn-secondary btn-compact';
    copy.append(icon('copy', 13));
    copy.append(document.createTextNode('复制摘要'));
    copy.addEventListener('click', () => {
      try { void navigator.clipboard?.writeText(text); } catch { /* clipboard is best-effort */ }
    });
    section.append(heading, hint, digestText, copy);
    root.append(section);

    const selection = root.ownerDocument.getSelection();
    const range = root.ownerDocument.createRange();
    range.selectNodeContents(digestText);
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  options.signal.addEventListener('abort', () => { destroyed = true; root.remove(); }, { once: true });

  render();
  return { element: root, render, showDigest, destroy: () => { destroyed = true; root.remove(); } };
};
