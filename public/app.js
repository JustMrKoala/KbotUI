const form = document.getElementById('spawn-form');
const submitBtn = document.getElementById('submit-btn');
const btnLabel = submitBtn.querySelector('.btn__label');
const btnSpinner = submitBtn.querySelector('.btn__spinner');
const statusCard = document.getElementById('status-card');
const statusTitle = document.getElementById('status-title');
const statusSubtitle = document.getElementById('status-subtitle');
const errorCard = document.getElementById('error-card');
const errorMessage = document.getElementById('error-message');
const results = document.getElementById('results');

function setLoading(active, platform, count) {
  submitBtn.disabled = active;
  btnLabel.textContent = active ? 'Bots running…' : 'Spawn bots';
  btnSpinner.hidden = !active;
  statusCard.hidden = !active;
  if (active) {
    statusTitle.textContent = `Spawning ${count} bot${count === 1 ? '' : 's'} on ${platform}`;
    statusSubtitle.textContent = 'Bots stay active until the game ends — this may take a while';
  }
}

function hidePanels() {
  errorCard.hidden = true;
  results.hidden = true;
}

function showError(message) {
  errorMessage.textContent = message;
  errorCard.hidden = false;
  results.hidden = true;
}

function statusPill(joined, status) {
  if (joined && status === 'completed') return ['pill pill--ok', 'Completed'];
  if (joined) return ['pill pill--ok', status || 'Joined'];
  return ['pill pill--fail', status || 'Failed'];
}

function renderResults(data) {
  document.getElementById('result-platform').textContent = data.platform;
  document.getElementById('result-title').textContent = `${data.summary.joined} of ${data.summary.attempted} bots joined`;
  document.getElementById('result-note').textContent = data.note;

  const joinLink = document.getElementById('result-join-url');
  joinLink.href = data.joinUrl;
  joinLink.textContent = `PIN ${data.gamePin}`;

  const stats = [
    ['Attempted', data.summary.attempted],
    ['Joined', data.summary.joined],
    ['Failed', data.summary.failed],
    ['Completed', data.summary.completed],
    ['Total answers', data.summary.totalAnswers],
    ['Success rate', data.summary.successRate],
  ];

  document.getElementById('stats-grid').innerHTML = stats
    .map(([label, value]) => `
      <div class="stat">
        <span class="stat__value">${value}</span>
        <span class="stat__label">${label}</span>
      </div>
    `)
    .join('');

  document.getElementById('players-body').innerHTML = data.players
    .map((player) => {
      const [pillClass, pillText] = statusPill(player.joined, player.status);
      return `
        <tr>
          <td>${escapeHtml(player.name)}</td>
          <td><span class="${pillClass}">${escapeHtml(pillText)}</span></td>
          <td>${player.joined ? 'Yes' : 'No'}</td>
          <td>${player.answers ?? 0}</td>
          <td>${escapeHtml(player.endReason || player.error || '—')}</td>
        </tr>
      `;
    })
    .join('');

  results.hidden = false;
}

function escapeHtml(text) {
  const el = document.createElement('span');
  el.textContent = text ?? '';
  return el.innerHTML;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  hidePanels();

  const platform = form.platform.value;
  const gamePin = form.gamePin.value.trim();
  const playerCount = Number(form.playerCount.value) || 5;
  const namePrefix = form.namePrefix.value.trim() || 'Bot';

  if (!gamePin) {
    showError('Game PIN is required.');
    return;
  }

  setLoading(true, platform, playerCount);

  try {
    const response = await fetch('/api/spawn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, gamePin, playerCount, namePrefix }),
    });

    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'Request failed');
    }

    renderResults(payload.result);
  } catch (err) {
    showError(err.message || 'Failed to spawn bots');
  } finally {
    setLoading(false);
  }
});

fetch('/api/info')
  .then((r) => r.json())
  .then((info) => {
    const countInput = document.getElementById('playerCount');
    countInput.max = info.maxBots;
    countInput.placeholder = String(info.defaultBotCount);
  })
  .catch(() => {});