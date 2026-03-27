import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const storageKey = "mathpower-messenger-config";

const state = {
  supabase: null,
  session: null,
  user: null,
  profile: null,
  channels: [],
  members: [],
  messages: [],
  unreadByChannel: new Map(),
  selectedChannel: null,
  selectedThreadMessage: null,
  realtimeChannel: null,
  isConfigExpanded: true,
};

const elements = {
  authPanel: document.querySelector("#auth-panel"),
  authSummary: document.querySelector("#auth-summary"),
  authUserName: document.querySelector("#auth-user-name"),
  authUserMeta: document.querySelector("#auth-user-meta"),
  toggleConfigButton: document.querySelector("#toggle-config-button"),
  authSubtext: document.querySelector("#auth-subtext"),
  configForm: document.querySelector("#config-form"),
  logoutButton: document.querySelector("#logout-button"),
  refreshButton: document.querySelector("#refresh-button"),
  badge: document.querySelector("#connection-badge"),
  profileCard: document.querySelector("#profile-card"),
  channelList: document.querySelector("#channel-list"),
  emptyState: document.querySelector("#empty-state"),
  chatLayout: document.querySelector("#chat-layout"),
  channelKind: document.querySelector("#channel-kind"),
  channelName: document.querySelector("#channel-name"),
  channelDescription: document.querySelector("#channel-description"),
  channelHighlight: document.querySelector("#channel-highlight"),
  messageCount: document.querySelector("#message-count"),
  memberCount: document.querySelector("#member-count"),
  messageSearch: document.querySelector("#message-search"),
  messageList: document.querySelector("#message-list"),
  composerForm: document.querySelector("#composer-form"),
  messageInput: document.querySelector("#message-input"),
  fileInput: document.querySelector("#file-input"),
  markReadButton: document.querySelector("#mark-read-button"),
  presenceSummary: document.querySelector("#presence-summary"),
  replyBanner: document.querySelector("#reply-banner"),
  replyLabel: document.querySelector("#reply-label"),
  clearReply: document.querySelector("#clear-reply"),
  memberList: document.querySelector("#member-list"),
  threadRoot: document.querySelector("#thread-root"),
  threadMeta: document.querySelector("#thread-meta"),
  emailInput: document.querySelector("#email"),
  passwordInput: document.querySelector("#password"),
  supabaseUrlInput: document.querySelector("#supabase-url"),
  supabaseKeyInput: document.querySelector("#supabase-key"),
};

bootstrap();

function bootstrap() {
  loadConfig();
  bindEvents();
}

function bindEvents() {
  elements.configForm.addEventListener("submit", handleLogin);
  elements.logoutButton.addEventListener("click", handleLogout);
  elements.refreshButton.addEventListener("click", refreshWorkspace);
  elements.messageSearch.addEventListener("input", renderMessages);
  elements.composerForm.addEventListener("submit", handleSendMessage);
  elements.markReadButton.addEventListener("click", markChannelAsRead);
  elements.clearReply.addEventListener("click", clearReplyTarget);
  elements.toggleConfigButton.addEventListener("click", toggleConfigPanel);
}

function loadConfig() {
  const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
  elements.supabaseUrlInput.value = saved.url || "";
  elements.supabaseKeyInput.value = saved.key || "";
  elements.emailInput.value = saved.email || "";
}

function saveConfig() {
  localStorage.setItem(storageKey, JSON.stringify({
    url: elements.supabaseUrlInput.value.trim(),
    key: elements.supabaseKeyInput.value.trim(),
    email: elements.emailInput.value.trim(),
  }));
}

function toggleConfigPanel() {
  if (!state.user) return;
  state.isConfigExpanded = !state.isConfigExpanded;
  syncAuthPanel();
}

async function handleLogin(event) {
  event.preventDefault();
  const url = elements.supabaseUrlInput.value.trim();
  const key = elements.supabaseKeyInput.value.trim();
  const email = elements.emailInput.value.trim();
  const password = elements.passwordInput.value;
  if (!url || !key || !email || !password) return notify("Supabase 정보와 로그인 계정을 모두 입력해주세요.");

  saveConfig();
  state.supabase = createClient(url, key);
  const { data, error } = await state.supabase.auth.signInWithPassword({ email, password });
  if (error) return notify(error.message);

  state.session = data.session;
  state.user = data.user;
  state.isConfigExpanded = false;
  await hydrateWorkspace();
}

async function hydrateWorkspace() {
  await loadProfile();
  await updatePresence("online");
  await loadUnreadCounts();
  await loadChannels();
  setConnected(true);
  syncAuthPanel();
  renderProfile();
  renderChannels();
}

async function loadProfile() {
  const { data, error } = await state.supabase
    .from("profiles")
    .select("id, name, role, homeroom, avatar_url")
    .eq("id", state.user.id)
    .single();

  if (error) return notify("프로필을 불러오지 못했습니다. profiles 테이블을 확인해주세요.");
  state.profile = data;
}

async function loadUnreadCounts() {
  if (!state.user) return;

  const { data: allMessages, error } = await state.supabase
    .from("messenger_messages")
    .select("id, channel_id");

  if (error) return;

  const { data: readRows } = await state.supabase
    .from("messenger_read_receipts")
    .select("message_id")
    .eq("user_id", state.user.id);

  const readSet = new Set((readRows || []).map((row) => row.message_id));
  const unreadMap = new Map();
  for (const message of allMessages || []) {
    if (!readSet.has(message.id)) unreadMap.set(message.channel_id, (unreadMap.get(message.channel_id) || 0) + 1);
  }
  state.unreadByChannel = unreadMap;
}

async function loadChannels() {
  const { data, error } = await state.supabase
    .from("messenger_channels")
    .select("id, name, description, type, member_count")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) return notify("채널 목록을 불러오지 못했습니다.");
  state.channels = data || [];
  if (!state.selectedChannel && state.channels[0]) await selectChannel(state.channels[0]);
}

async function selectChannel(channel) {
  state.selectedChannel = channel;
  state.selectedThreadMessage = null;
  renderChannels();
  renderSelectedChannel();
  await Promise.all([loadMembers(channel.id), loadMessages(channel.id)]);
  await subscribeChannel(channel.id);
}

async function loadMembers(channelId) {
  const { data, error } = await state.supabase
    .from("messenger_channel_members")
    .select("channel_id, user_id, user_name, role")
    .eq("channel_id", channelId)
    .order("user_name", { ascending: true });

  if (error) return notify("채널 멤버를 불러오지 못했습니다.");

  const userIds = (data || []).map((row) => row.user_id);
  let presenceMap = new Map();
  if (userIds.length) {
    const { data: presenceRows } = await state.supabase
      .from("messenger_presence")
      .select("user_id, status, last_seen_at")
      .in("user_id", userIds);
    presenceMap = new Map((presenceRows || []).map((row) => [row.user_id, row]));
  }

  state.members = (data || []).map((row) => ({
    user_id: row.user_id,
    user_name: row.user_name,
    role: row.role,
    presence: presenceMap.get(row.user_id) || null,
  }));
  renderMembers();
}

async function loadMessages(channelId) {
  const { data, error } = await state.supabase
    .from("messenger_messages")
    .select("id, channel_id, sender_id, sender_name, content, reply_to, attachment_url, created_at")
    .eq("channel_id", channelId)
    .order("created_at", { ascending: true });

  if (error) return notify("메시지를 불러오지 못했습니다.");

  const messages = data || [];
  const ids = messages.map((message) => message.id);
  let readCounts = new Map();
  let myReadSet = new Set();

  if (ids.length) {
    const { data: receipts } = await state.supabase
      .from("messenger_read_receipts")
      .select("message_id, user_id")
      .in("message_id", ids);

    for (const receipt of receipts || []) {
      readCounts.set(receipt.message_id, (readCounts.get(receipt.message_id) || 0) + 1);
      if (receipt.user_id === state.user.id) myReadSet.add(receipt.message_id);
    }
  }

  state.messages = messages.map((message) => ({
    ...message,
    read_count: readCounts.get(message.id) || 0,
    is_read_by_me: myReadSet.has(message.id),
  }));

  renderMessages();
  renderThread();
}

async function subscribeChannel(channelId) {
  if (state.realtimeChannel) await state.supabase.removeChannel(state.realtimeChannel);

  state.realtimeChannel = state.supabase
    .channel(`messenger-room-${channelId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "messenger_messages", filter: `channel_id=eq.${channelId}` }, async () => {
      await Promise.all([loadUnreadCounts(), loadMessages(channelId)]);
      renderChannels();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "messenger_presence" }, async () => {
      await loadMembers(channelId);
    })
    .subscribe();
}

async function handleSendMessage(event) {
  event.preventDefault();
  if (!state.selectedChannel || !state.profile) return notify("먼저 채널과 로그인 상태를 확인해주세요.");

  const rawContent = elements.messageInput.value.trim();
  const file = elements.fileInput.files[0];
  if (!rawContent && !file) return notify("메시지 또는 파일을 입력해주세요.");

  let attachmentUrl = null;
  if (file) {
    attachmentUrl = await uploadFile(file, state.selectedChannel.id);
    if (!attachmentUrl) return;
  }

  const payload = {
    channel_id: state.selectedChannel.id,
    sender_id: state.user.id,
    sender_name: state.profile.name,
    content: rawContent,
    reply_to: state.selectedThreadMessage?.id || null,
    attachment_url: attachmentUrl,
  };

  const { data: msgData, error } = await state.supabase
    .from("messenger_messages")
    .insert(payload)
    .select()
    .single();

  if (error) return notify(error.message);

  await saveMentions(rawContent, msgData.id, state.selectedChannel.id);
  elements.composerForm.reset();
  clearReplyTarget();
  await Promise.all([loadUnreadCounts(), loadMessages(state.selectedChannel.id)]);
  renderChannels();
}

async function saveMentions(content, messageId, channelId) {
  const mentionNames = [...content.matchAll(/@([a-zA-Z0-9가-힣_]+)/g)].map((entry) => entry[1]);
  if (!mentionNames.length) return;

  const matched = state.members.filter((member) => mentionNames.includes(member.user_name));
  if (!matched.length) return;

  const mentionRows = matched.map((member) => ({
    message_id: messageId,
    channel_id: channelId,
    mentioned_user_id: member.user_id,
    mentioned_by_id: state.user.id,
    mentioned_by_name: state.profile.name,
  }));

  const { error } = await state.supabase.from("messenger_mentions").insert(mentionRows);
  if (error) notify("멘션 저장에는 실패했지만 메시지는 전송되었습니다.");
}

async function markChannelAsRead() {
  if (!state.selectedChannel || !state.messages.length) return;

  const readRows = state.messages.map((message) => ({
    message_id: message.id,
    user_id: state.user.id,
    channel_id: state.selectedChannel.id,
    read_at: new Date().toISOString(),
  }));

  const { error } = await state.supabase
    .from("messenger_read_receipts")
    .upsert(readRows, { onConflict: "message_id,user_id", ignoreDuplicates: true });

  if (error) return notify("읽음 처리에 실패했습니다.");

  await Promise.all([loadUnreadCounts(), loadMessages(state.selectedChannel.id)]);
  renderChannels();
}

async function uploadFile(file, channelId) {
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const path = `${channelId}/${Date.now()}.${ext}`;
  const { error } = await state.supabase.storage.from("messenger-files").upload(path, file);
  if (error) return notify("파일 업로드에 실패했습니다."), null;
  const { data } = state.supabase.storage.from("messenger-files").getPublicUrl(path);
  return data.publicUrl;
}

async function updatePresence(status) {
  if (!state.user || !state.profile) return;
  await state.supabase
    .from("messenger_presence")
    .upsert({ user_id: state.user.id, user_name: state.profile.name, status, last_seen_at: new Date().toISOString() }, { onConflict: "user_id" });
}

async function handleLogout() {
  if (!state.supabase) return;
  await updatePresence("offline");
  await state.supabase.auth.signOut();
  if (state.realtimeChannel) await state.supabase.removeChannel(state.realtimeChannel);

  state.supabase = null;
  state.session = null;
  state.user = null;
  state.profile = null;
  state.channels = [];
  state.members = [];
  state.messages = [];
  state.unreadByChannel = new Map();
  state.selectedChannel = null;
  state.selectedThreadMessage = null;
  state.isConfigExpanded = true;

  setConnected(false);
  syncAuthPanel();
  renderProfile();
  renderChannels();
  renderSelectedChannel();
  renderMembers();
  renderMessages();
  renderThread();
}

async function refreshWorkspace() {
  if (!state.supabase || !state.user) return;
  await hydrateWorkspace();
  if (state.selectedChannel) await Promise.all([loadMembers(state.selectedChannel.id), loadMessages(state.selectedChannel.id)]);
}

function syncAuthPanel() {
  const isLoggedIn = Boolean(state.user && state.profile);
  elements.authPanel.classList.toggle("is-logged-in", isLoggedIn);
  elements.configForm.classList.toggle("hidden", isLoggedIn && !state.isConfigExpanded);
  elements.authSummary.classList.toggle("hidden", !isLoggedIn);
  elements.authSubtext.textContent = isLoggedIn
    ? "현재 로그인 세션이 유지되고 있습니다. 필요할 때만 설정을 펼쳐 수정하세요."
    : "Supabase 계정으로 로그인해 메신저를 시작하세요.";

  if (isLoggedIn) {
    elements.authUserName.textContent = state.profile.name;
    elements.authUserMeta.textContent = `${state.profile.role || "member"} · ${state.profile.homeroom || "소속 미지정"}`;
    elements.toggleConfigButton.textContent = state.isConfigExpanded ? "설정 접기" : "설정 보기";
  }
}

function renderProfile() {
  if (!state.profile) {
    elements.profileCard.innerHTML = '<p class="profile-card__name">로그인이 필요합니다</p><p class="profile-card__meta">Supabase 계정으로 로그인하면 프로필을 불러옵니다.</p>';
    return;
  }

  elements.profileCard.innerHTML = `
    <p class="profile-card__name">${escapeHtml(state.profile.name)}</p>
    <p class="profile-card__meta">${escapeHtml(state.profile.role || "member")} · ${escapeHtml(state.profile.homeroom || "소속 미지정")}</p>
  `;
}

function renderChannels() {
  elements.channelList.innerHTML = "";
  if (!state.channels.length) return void (elements.channelList.innerHTML = '<p class="profile-card__meta">채널이 없습니다.</p>');

  const template = document.querySelector("#channel-item-template");
  state.channels.forEach((channel) => {
    const fragment = template.content.cloneNode(true);
    const button = fragment.querySelector(".channel-item");
    const badges = fragment.querySelector(".channel-item__badges");
    const unreadCount = state.unreadByChannel.get(channel.id) || 0;

    fragment.querySelector(".channel-item__name").textContent = channel.name;
    fragment.querySelector(".channel-item__meta").textContent = channel.description || channel.type || "설명 없음";

    if (channel.type === "announcement") badges.appendChild(makeBadge("공지", "channel-badge channel-badge--announcement"));
    if (unreadCount > 0) badges.appendChild(makeBadge(String(unreadCount), "channel-badge channel-badge--unread"));

    if (state.selectedChannel?.id === channel.id) button.classList.add("is-active");
    if (unreadCount > 0) button.classList.add("has-unread");

    button.addEventListener("click", () => {
      selectChannel(channel);
    });

    elements.channelList.appendChild(fragment);
  });
}

function renderSelectedChannel() {
  const channel = state.selectedChannel;
  const hasChannel = Boolean(channel);

  elements.emptyState.classList.toggle("hidden", hasChannel);
  elements.chatLayout.classList.toggle("hidden", !hasChannel);

  if (!hasChannel) {
    elements.channelName.textContent = "채널을 선택하세요";
    elements.channelDescription.textContent = "왼쪽에서 채널을 선택하면 대화를 불러옵니다.";
    elements.channelKind.textContent = "CHANNEL";
    elements.presenceSummary.textContent = "오프라인";
    elements.channelHighlight.textContent = "일반 채널";
    return;
  }

  elements.channelName.textContent = channel.name;
  elements.channelDescription.textContent = channel.description || "설명이 없는 채널입니다.";
  elements.channelKind.textContent = channel.type || "CHANNEL";
  elements.presenceSummary.textContent = "실시간 연결 중";
  elements.channelHighlight.textContent = channel.type === "announcement" ? "공지 중심 채널" : "일반 대화 채널";
}

function renderMessages() {
  elements.messageList.innerHTML = "";
  const query = elements.messageSearch.value.trim().toLowerCase();
  const filtered = state.messages.filter((message) => (`${message.sender_name} ${message.content || ""}`).toLowerCase().includes(query));
  elements.messageCount.textContent = `메시지 ${filtered.length}개`;

  if (!filtered.length) {
    elements.messageList.innerHTML = '<p class="thread-root__placeholder">아직 메시지가 없습니다. 첫 대화를 시작해보세요.</p>';
    return;
  }

  const template = document.querySelector("#message-item-template");
  filtered.forEach((message) => {
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector(".message-card");
    const flag = fragment.querySelector(".message-card__flag");
    const file = fragment.querySelector(".message-file");
    const replyCount = state.messages.filter((entry) => entry.reply_to === message.id).length;
    const isAnnouncement = state.selectedChannel?.type === "announcement" && !message.reply_to;

    fragment.querySelector(".message-author").textContent = message.sender_name;
    fragment.querySelector(".message-time").textContent = formatDate(message.created_at);
    fragment.querySelector(".message-card__body").innerHTML = renderMentions(message.content || "");
    fragment.querySelector(".message-thread").textContent = replyCount ? `스레드 ${replyCount}개` : "스레드 없음";
    fragment.querySelector(".message-read").textContent = `읽음 ${message.read_count || 0}`;

    if (!message.is_read_by_me) card.classList.add("is-unread");
    if (state.selectedThreadMessage?.id === message.id) card.classList.add("is-selected");
    if (isAnnouncement) {
      flag.classList.remove("hidden");
      flag.textContent = "공지";
      card.classList.add("message-card--announcement");
    }

    if (message.attachment_url) {
      file.classList.remove("hidden");
      file.href = message.attachment_url;
    }

    const focusThread = () => {
      state.selectedThreadMessage = message;
      elements.replyBanner.classList.remove("hidden");
      elements.replyLabel.textContent = `${message.sender_name} 메시지에 답글 작성 중`;
      renderMessages();
      renderThread();
    };

    fragment.querySelector(".reply-button").addEventListener("click", focusThread);
    card.addEventListener("click", focusThread);
    elements.messageList.appendChild(fragment);
  });
}

function renderThread() {
  elements.threadRoot.innerHTML = "";
  if (!state.selectedThreadMessage) {
    elements.threadMeta.textContent = "메시지를 선택하면 스레드와 요약이 표시됩니다.";
    elements.threadRoot.innerHTML = '<p class="thread-root__placeholder">메시지를 선택하면 스레드 답글이 여기에 정리됩니다.</p>';
    return;
  }

  const root = state.selectedThreadMessage;
  const replies = state.messages.filter((message) => message.reply_to === root.id);
  elements.threadMeta.textContent = `${root.sender_name}님의 메시지 · 답글 ${replies.length}개`;

  const summary = document.createElement("section");
  summary.className = "thread-summary";
  summary.innerHTML = `
    <div class="thread-summary__eyebrow">원본 메시지</div>
    <strong>${escapeHtml(root.sender_name)}</strong>
    <p>${renderMentions(root.content || "")}</p>
    <small>${formatDate(root.created_at)}</small>
  `;
  elements.threadRoot.appendChild(summary);

  if (!replies.length) {
    const empty = document.createElement("p");
    empty.className = "thread-root__placeholder";
    empty.textContent = "아직 답글이 없습니다. 이 스레드의 첫 답글을 남겨보세요.";
    elements.threadRoot.appendChild(empty);
    return;
  }

  replies.forEach((message, index) => {
    const card = document.createElement("article");
    card.className = "thread-message";
    card.innerHTML = `
      <div class="thread-message__top">
        <strong>${escapeHtml(message.sender_name)}</strong>
        <span>${index + 1}번째 답글</span>
      </div>
      <p>${renderMentions(message.content || "")}</p>
      <small>${formatDate(message.created_at)}</small>
    `;
    elements.threadRoot.appendChild(card);
  });
}

function renderMembers() {
  elements.memberList.innerHTML = "";
  elements.memberCount.textContent = `멤버 ${state.members.length}명`;
  if (!state.members.length) return void (elements.memberList.innerHTML = '<p class="thread-root__placeholder">멤버 정보가 없습니다.</p>');

  state.members.forEach((member) => {
    const card = document.createElement("article");
    card.className = "member-card";
    const status = member.presence?.status || "offline";
    const lastSeen = member.presence?.last_seen_at ? formatDate(member.presence.last_seen_at) : "기록 없음";
    card.innerHTML = `
      <div class="member-card__top">
        <strong>${escapeHtml(member.user_name)}</strong>
        <span class="member-card__status"><span class="status-dot"></span>${escapeHtml(status)}</span>
      </div>
      <p class="profile-card__meta">${escapeHtml(member.role || "member")} · 마지막 활동 ${escapeHtml(lastSeen)}</p>
    `;
    elements.memberList.appendChild(card);
  });
}

function clearReplyTarget() {
  state.selectedThreadMessage = null;
  elements.replyBanner.classList.add("hidden");
  elements.replyLabel.textContent = "답글 대상 없음";
  renderMessages();
  renderThread();
}

function setConnected(isConnected) {
  elements.badge.textContent = isConnected ? "연결됨" : "미연결";
  elements.badge.className = `badge ${isConnected ? "badge--active" : "badge--idle"}`;
}

function makeBadge(text, className) {
  const badge = document.createElement("span");
  badge.className = className;
  badge.textContent = text;
  return badge;
}

function notify(message) {
  window.alert(message);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function renderMentions(content) {
  return escapeHtml(content).replace(/@([a-zA-Z0-9가-힣_]+)/g, '<span class="mention">@$1</span>');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
