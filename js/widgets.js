/* ============================================================
   widgets.js — Tasks / Notes / Alerts panes.
   Kept deliberately thin: render from state, mutate state, save.
   ============================================================ */

import { state, save, uid } from './store.js';
import { relativeTime } from './commands.js';

const $ = (sel, root = document) => root.querySelector(sel);

export function createModules(app) {
  const els = {
    taskList: $('#task-list'),
    noteList: $('#note-list'),
    reminderList: $('#reminder-list'),
    taskForm: $('#task-form'),
    taskInput: $('#task-input'),
    noteForm: $('#note-form'),
    noteInput: $('#note-input'),
    reminderForm: $('#reminder-form'),
    reminderInput: $('#reminder-input'),
    badgeTasks: $('#badge-tasks'),
    badgeNotes: $('#badge-notes'),
    badgeReminders: $('#badge-reminders'),
    clearTasks: $('#btn-clear-tasks'),
    tabs: [...document.querySelectorAll('.tab')],
    panes: [...document.querySelectorAll('.tab-pane')],
  };

  let activeTab = 'tasks';

  /* ── helpers ─────────────────────────────────────────────── */

  function emptyState(message, hint) {
    const div = document.createElement('li');
    div.className = 'empty';
    const strong = document.createElement('strong');
    strong.textContent = message;
    div.append(strong, document.createTextNode(hint));
    return div;
  }

  function makeItem(text, meta) {
    const li = document.createElement('li');
    li.className = 'item';

    const body = document.createElement('div');
    body.className = 'item-body';

    const textEl = document.createElement('div');
    textEl.className = 'item-text';
    textEl.textContent = text;

    const metaEl = document.createElement('div');
    metaEl.className = 'item-meta';
    metaEl.textContent = meta;

    body.append(textEl, metaEl);
    return { li, body, textEl, metaEl };
  }

  function deleteButton(label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'item-del';
    btn.setAttribute('aria-label', label);
    btn.textContent = '×';
    return btn;
  }

  /* ── tasks ───────────────────────────────────────────────── */

  function renderTasks() {
    const list = els.taskList;
    list.textContent = '';
    const open = state.tasks.filter((t) => !t.done).length;
    els.badgeTasks.textContent = String(open);

    if (!state.tasks.length) {
      list.append(emptyState('No tasks yet', 'Add one above, or say “add task …”.'));
      return;
    }

    state.tasks.forEach((task, index) => {
      const { li, body } = makeItem(task.text, `#${index + 1} · added ${relativeTime(task.createdAt)}`);
      li.dataset.id = task.id;
      if (task.done) li.classList.add('is-done');

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'item-check';
      check.checked = task.done;
      check.setAttribute('aria-label', `Mark " ${task.text} " ${task.done ? 'not done' : 'done'}`);
      check.addEventListener('change', () => {
        task.done = check.checked;
        save();
        render();
        app.beep(check.checked ? 'done' : 'click');
      });

      const del = deleteButton(`Delete task: ${task.text}`);
      del.addEventListener('click', () => {
        const i = state.tasks.findIndex((t) => t.id === task.id);
        if (i > -1) state.tasks.splice(i, 1);
        save();
        render();
        app.beep('click');
      });

      li.append(check, body, del);
      list.append(li);
    });
  }

  /* ── notes ───────────────────────────────────────────────── */

  function renderNotes() {
    const list = els.noteList;
    list.textContent = '';
    els.badgeNotes.textContent = String(state.notes.length);

    if (!state.notes.length) {
      list.append(emptyState('No notes yet', 'Jot one above, or say “note …”.'));
      return;
    }

    state.notes.forEach((note) => {
      const { li, body } = makeItem(note.text, relativeTime(note.createdAt));
      const del = deleteButton(`Delete note: ${note.text}`);
      del.addEventListener('click', () => {
        const i = state.notes.findIndex((n) => n.id === note.id);
        if (i > -1) state.notes.splice(i, 1);
        save();
        render();
        app.beep('click');
      });
      li.append(body, del);
      list.append(li);
    });
  }

  /* ── reminders ───────────────────────────────────────────── */

  function renderReminders() {
    const list = els.reminderList;
    list.textContent = '';
    const now = Date.now();
    const pending = state.reminders.filter((r) => r.due > now).length;
    els.badgeReminders.textContent = String(pending);

    if (!state.reminders.length) {
      list.append(emptyState('No alerts scheduled', 'Say “remind me in 10 minutes to …”.'));
      return;
    }

    state.reminders.forEach((reminder) => {
      const overdue = reminder.due <= now;
      const when = new Date(reminder.due);
      const clock = when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const { li, body } = makeItem(
        reminder.text,
        `${overdue ? 'due' : 'scheduled'} ${clock} · ${relativeTime(reminder.due)}`,
      );

      const pill = document.createElement('span');
      pill.className = 'item-pill';
      if (overdue) pill.classList.add('is-due');
      pill.textContent = overdue ? 'DUE' : clock;

      const del = deleteButton(`Delete reminder: ${reminder.text}`);
      del.addEventListener('click', () => {
        const i = state.reminders.findIndex((r) => r.id === reminder.id);
        if (i > -1) state.reminders.splice(i, 1);
        save();
        render();
        app.scheduleReminders();
        app.beep('click');
      });

      li.append(body, pill, del);
      list.append(li);
    });
  }

  /* ── tabs ────────────────────────────────────────────────── */

  function openTab(name) {
    if (!['tasks', 'notes', 'reminders'].includes(name)) return;
    activeTab = name;
    els.tabs.forEach((tab) => {
      const on = tab.dataset.tab === name;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', String(on));
    });
    els.panes.forEach((pane) => {
      pane.classList.toggle('is-active', pane.dataset.pane === name);
    });
    const input = name === 'tasks' ? els.taskInput : name === 'notes' ? els.noteInput : els.reminderInput;
    if (document.activeElement === document.body) input.focus({ preventScroll: true });
  }

  els.tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      openTab(tab.dataset.tab);
      app.beep('click');
    });
  });

  function render() {
    renderTasks();
    renderNotes();
    renderReminders();
  }

  /* ── forms ───────────────────────────────────────────────── */

  els.taskForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = els.taskInput.value.trim();
    if (!value) return;
    state.tasks.unshift({ id: uid(), text: value, done: false, createdAt: Date.now() });
    els.taskInput.value = '';
    save();
    render();
    app.beep('done');
  });

  els.noteForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = els.noteInput.value.trim();
    if (!value) return;
    state.notes.unshift({ id: uid(), text: value, createdAt: Date.now() });
    els.noteInput.value = '';
    save();
    render();
    app.beep('done');
  });

  els.reminderForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = els.reminderInput.value.trim();
    if (!raw) return;
    app.remindFromText(raw);
    els.reminderInput.value = '';
  });

  els.clearTasks.addEventListener('click', () => {
    const before = state.tasks.length;
    state.tasks = state.tasks.filter((t) => !t.done);
    if (state.tasks.length !== before) {
      save();
      render();
      app.toast('TASKS', `${before - state.tasks.length} completed task(s) cleared.`);
    }
  });

  return { render, openTab, get activeTab() { return activeTab; } };
}
