import { supabase } from './supabase-client.js';

const $ = (id) => document.getElementById(id);
const ALL_STATUSES = ['all', 'pending', 'approved', 'rejected'];
let tournaments = [];
let adminTournamentNames = new Map();
let countdownInterval = null;

function errorText(error) {
  if (error && typeof error.message === 'string') return error.message;
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

function formatMatchDate(value) {
  return value
    ? new Date(value).toLocaleString(undefined, { timeZoneName: 'short' })
    : 'Schedule to be announced';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (match) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[match]));
}

function getTournamentNameMap(items) {
  const map = new Map();
  (items || []).forEach((item) => map.set(item.id, item.name));
  return map;
}

function getFilterState() {
  return {
    search: $('registrationSearch') ? $('registrationSearch').value.trim().toLowerCase() : '',
    status: $('registrationStatusFilter') ? $('registrationStatusFilter').value : 'all',
  };
}

function matchesFilter(player, filter) {
  if (filter.status !== 'all' && player.status !== filter.status) return false;
  if (!filter.search) return true;

  const haystack = [
    player.name,
    player.uid,
    player.contact,
    player.status,
    player.mode,
    player.tournament_name || '',
  ].join(' ').toLowerCase();

  return haystack.includes(filter.search);
}

function setBanner(message, type = 'status') {
  const banner = $('adminMessage');
  if (!banner) return;
  banner.textContent = message;
  banner.dataset.type = type;
}

async function loadRegistrations(status = getFilterState().status) {
  if (!supabase) {
    throw new Error('Supabase is not configured. Add your project URL and publishable key in config/config.js.');
  }

  let query = supabase
    .from('registrations')
    .select('id, name, uid, mode, contact, status, points, created_at, tournament_id')
    .order('created_at', { ascending: false });

  if (status !== 'all') {
    query = query.eq('status', status);
  }

  const { data: registrations, error } = await query;
  if (error) {
    console.error('Failed to fetch registrations:', error);
    throw error;
  }
  return registrations || [];
}

async function loadTournaments() {
  if (!supabase) {
    throw new Error('Supabase is not configured. Add your project URL and publishable key in config/config.js.');
  }

  const { data, error } = await supabase
    .from('tournaments')
    .select('id, name, mode, match_at, entry_fee, prize_pool, max_teams, status, rules')
    .order('match_at', { ascending: true, nullsLast: true });

  if (error) throw error;
  return data || [];
}

async function renderTournaments() {
  const cards = $('tournamentCards');
  const select = $('registrationTournament');
  const leaderboard = $('leaderboardTournament');

  if (!cards || !select || !leaderboard) return;

  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  cards.replaceChildren();
  select.replaceChildren(new Option('General registration', ''));
  leaderboard.replaceChildren(new Option('All tournaments', ''));

  try {
    const { data, error } = await supabase
      .from('tournaments')
      .select('id, name, mode, match_at, entry_fee, prize_pool, max_teams, status, rules')
      .in('status', ['open', 'closed', 'live', 'completed', 'cancelled'])
      .order('match_at', { ascending: true, nullsFirst: false });

    if (error) throw error;

    tournaments = data || [];
    document.body.dataset.tournaments = JSON.stringify(tournaments);

    tournaments.forEach((item) => {
      leaderboard.add(new Option(item.name, item.id));
      if (item.status === 'open') {
        select.add(new Option(item.name, item.id));
      }
    });

    if (!tournaments.length) {
      cards.textContent = 'No tournaments are available right now.';
      $('tournamentMessage').textContent = '';
      return;
    }

    tournaments.forEach((tournament) => {
      const article = document.createElement('article');
      article.className = 'card';

      const kicker = document.createElement('div');
      kicker.className = 'kicker';
      kicker.textContent = tournament.mode.toUpperCase();

      const title = document.createElement('h3');
      title.textContent = tournament.name;

      const details = document.createElement('p');
      const matchDate = formatMatchDate(tournament.match_at);
      details.textContent = `${matchDate} - Entry: ${tournament.entry_fee} - Prize: ${tournament.prize_pool} - Max teams: ${tournament.max_teams}`;

      const countdown = document.createElement('p');
      countdown.className = 'tournament-countdown note';
      countdown.dataset.matchAt = tournament.match_at || '';
      countdown.dataset.status = tournament.status;

      const info = document.createElement('p');
      info.textContent = tournament.rules || 'Fresh competition details will be shared with approved players.';

      const bottom = document.createElement('div');
      bottom.className = 'card-bottom';
      const status = document.createElement('span');
      status.className = 'tournament-status';
      status.dataset.matchAt = tournament.match_at || '';
      status.dataset.status = tournament.status;
      status.textContent = tournament.status === 'open' && tournament.match_at && Date.parse(tournament.match_at) > Date.now()
        ? 'Upcoming'
        : tournament.status.charAt(0).toUpperCase() + tournament.status.slice(1);
      bottom.appendChild(status);

      if (tournament.status === 'open') {
        const join = document.createElement('button');
        join.type = 'button';
        join.className = 'btn small';
        join.textContent = 'Join';
        join.addEventListener('click', () => {
          select.value = tournament.id;
          const modeField = $('gameMode');
          if (modeField) {
            modeField.value = tournament.mode;
            modeField.disabled = true;
          }
          document.getElementById('register').scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        bottom.appendChild(join);
      }

      article.append(kicker, title, details, countdown, info, bottom);
      cards.appendChild(article);
    });

    updateTournamentCountdowns();
    countdownInterval = setInterval(updateTournamentCountdowns, 1000);
    $('tournamentMessage').textContent = '';
  } catch (error) {
    console.error('Tournament load failed:', error);
    $('tournamentMessage').textContent = `Tournaments could not be loaded: ${errorText(error)}`;
  }
}

function updateTournamentCountdowns() {
  document.querySelectorAll('#tournamentCards .tournament-status').forEach((element) => {
    const status = element.dataset.status;
    const startAt = Date.parse(element.dataset.matchAt);
    const label = status === 'open' && Number.isFinite(startAt) && startAt > Date.now()
      ? 'Upcoming'
      : status.charAt(0).toUpperCase() + status.slice(1);
    element.textContent = label;
  });

  document.querySelectorAll('#tournamentCards .tournament-countdown').forEach((element) => {
    const status = element.dataset.status;
    const startAt = Date.parse(element.dataset.matchAt);
    if (status === 'live') {
      element.textContent = 'Live now';
    } else if (status === 'completed') {
      element.textContent = 'Tournament completed';
    } else if (status === 'cancelled') {
      element.textContent = 'Tournament cancelled';
    } else if (status === 'open' && Number.isFinite(startAt) && startAt > Date.now()) {
      let remaining = Math.floor((startAt - Date.now()) / 1000);
      const days = Math.floor(remaining / 86400);
      remaining %= 86400;
      const hours = Math.floor(remaining / 3600);
      remaining %= 3600;
      const minutes = Math.floor(remaining / 60);
      const seconds = remaining % 60;
      element.textContent = `Starts in ${days}d ${hours}h ${minutes}m ${seconds}s`;
    } else if (status === 'open') {
      element.textContent = 'Registration open';
    } else {
      element.textContent = '';
    }
  });
}

async function renderLeaderboard() {
  const tbody = $('leaderboardRows');
  if (!tbody) return;

  tbody.replaceChildren();

  try {
    const { data: players, error } = await supabase
      .from('public_leaderboard')
      .select('name, mode, points, tournament_id')
      .order('points', { ascending: false })
      .order('name', { ascending: true });

    if (error) throw error;

    const tournamentId = $('leaderboardTournament') ? $('leaderboardTournament').value : '';
    const rankedPlayers = tournamentId
      ? (players || []).filter((player) => player.tournament_id === tournamentId)
      : (players || []);

    if (!rankedPlayers.length) {
      tbody.innerHTML = '<tr><td colspan="4">No approved players yet.</td></tr>';
      $('leaderboardMessage').textContent = 'Approved players and points will appear here.';
      return;
    }

    let previousPoints = null;
    let previousRank = 0;

    rankedPlayers.forEach((player, index) => {
      const score = Number(player.points) || 0;
      const rank = score === previousPoints ? previousRank : index + 1;
      previousPoints = score;
      previousRank = rank;

      const tr = document.createElement('tr');
      [rank, player.name, player.mode, score].forEach((value) => {
        const td = document.createElement('td');
        td.textContent = String(value);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    $('leaderboardMessage').textContent = 'Leaderboard synced from approved tournament registrations.';
  } catch (error) {
    console.error('Leaderboard load failed:', error);
    $('leaderboardMessage').textContent = `Leaderboard could not be loaded: ${errorText(error)}`;
  }
}

function renderAdminRows(registrations, tournaments) {
  const tbody = $('adminRows');
  if (!tbody) return;
  const tournamentNameMap = getTournamentNameMap(tournaments);
  const filter = getFilterState();
  const visible = registrations.filter((player) => matchesFilter({
    ...player,
    tournament_name: tournamentNameMap.get(player.tournament_id),
  }, filter));

  tbody.innerHTML = '';

  if (!visible.length) {
    const emptyMessage = filter.status === 'pending'
      ? 'No pending registrations found.'
      : 'No matching registrations found.';
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 7;
    cell.textContent = emptyMessage;
    row.appendChild(cell);
    tbody.replaceChildren(row);
    return;
  }

  visible.forEach((player) => {
    const row = document.createElement('tr');
    const nameCell = document.createElement('td');
    const tournamentName = tournamentNameMap.get(player.tournament_id) || 'General Reg';
    nameCell.innerHTML = `<strong>${escapeHtml(player.name)}</strong><div>${escapeHtml(player.uid)}</div>`;

    const tournamentCell = document.createElement('td');
    tournamentCell.textContent = tournamentName;

    const modeCell = document.createElement('td');
    modeCell.textContent = player.mode;

    const statusCell = document.createElement('td');
    const statusSelect = document.createElement('select');
    ALL_STATUSES.slice(1).forEach((value) => {
      statusSelect.add(new Option(value, value));
    });
    statusSelect.value = player.status;
    statusCell.appendChild(statusSelect);

    const pointsCell = document.createElement('td');
    const pointsInput = document.createElement('input');
    pointsInput.type = 'number';
    pointsInput.min = '0';
    pointsInput.max = '999999';
    pointsInput.step = '1';
    pointsInput.value = String(Number(player.points) || 0);
    pointsCell.appendChild(pointsInput);

    const actionCell = document.createElement('td');
    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'btn small';
    saveButton.textContent = 'Save';
    saveButton.addEventListener('click', async () => {
      const nextStatus = statusSelect.value;
      const nextPoints = Number(pointsInput.value);
      if (!Number.isInteger(nextPoints) || nextPoints < 0 || nextPoints > 999999) {
        setBanner('Points must be between 0 and 999999.', 'error');
        return;
      }

      saveButton.disabled = true;
      try {
        const { error } = await supabase.from('registrations').update({
          status: nextStatus,
          points: nextPoints,
        }).eq('id', player.id);

        if (error) throw error;
        setBanner('Registration updated successfully.', 'success');
        await refreshAdminDashboard();
      } catch (error) {
        console.error('Registration update failed:', error);
        setBanner(`Update failed: ${errorText(error)}`, 'error');
      } finally {
        saveButton.disabled = false;
      }
    });
    actionCell.appendChild(saveButton);

    const deleteCell = document.createElement('td');
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn small alt';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', async () => {
      if (!window.confirm(`Delete ${player.name}?`)) return;
      deleteButton.disabled = true;
      try {
        const { error } = await supabase.from('registrations').delete().eq('id', player.id);
        if (error) throw error;
        setBanner('Registration deleted.', 'success');
        await refreshAdminDashboard();
      } catch (error) {
        console.error('Registration delete failed:', error);
        setBanner(`Delete failed: ${errorText(error)}`, 'error');
      } finally {
        deleteButton.disabled = false;
      }
    });
    deleteCell.appendChild(deleteButton);

    row.append(nameCell, tournamentCell, modeCell, statusCell, pointsCell, actionCell, deleteCell);
    tbody.appendChild(row);
  });
}

function resetTournamentForm() {
  const form = $('tournamentForm');
  if (form) form.reset();
  $('tournamentId').value = '';
  $('tournamentEntryFee').value = '0';
  $('tournamentPrizePool').value = '0';
  $('tournamentMaxTeams').value = '48';
  $('tournamentStatus').value = 'draft';
  $('tournamentSaveButton').textContent = 'Create tournament';
  $('cancelTournamentEdit').classList.add('hidden');
}

async function renderAdminTournaments() {
  const tbody = $('tournamentAdminRows');
  if (!tbody) return;

  tbody.replaceChildren();
  adminTournamentNames = new Map();
  const msg = $('tournamentAdminMessage');
  if (msg) msg.textContent = 'Loading tournaments...';

  try {
    const [{ data: items, error }, { data: registrations, error: registrationError }] = await Promise.all([
      supabase.from('tournaments')
        .select('id, name, mode, match_at, entry_fee, prize_pool, max_teams, status, rules')
        .order('created_at', { ascending: false }),
      supabase.from('registrations').select('tournament_id, status')
    ]);

    if (error) throw error;
    if (registrationError) throw registrationError;

    items.forEach((item) => adminTournamentNames.set(item.id, item.name));
    const teamCounts = new Map();
    (registrations || []).forEach((registration) => {
      if (registration.tournament_id && registration.status !== 'rejected') {
        teamCounts.set(registration.tournament_id, (teamCounts.get(registration.tournament_id) || 0) + 1);
      }
    });

    if (!items.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.textContent = 'No tournaments created yet.';
      row.appendChild(cell);
      tbody.appendChild(row);
      if (msg) msg.textContent = '';
      return;
    }

    items.forEach((item) => {
      const row = document.createElement('tr');
      const name = document.createElement('td');
      name.textContent = `${item.name} (${item.mode})`;

      const date = document.createElement('td');
      date.textContent = item.match_at ? formatMatchDate(item.match_at) : 'Not scheduled';

      const count = document.createElement('td');
      count.textContent = `${teamCounts.get(item.id) || 0} / ${item.max_teams}`;

      const statusCell = document.createElement('td');
      const status = document.createElement('select');
      ['draft', 'open', 'closed', 'live', 'completed', 'cancelled'].forEach((value) => status.add(new Option(value, value)));
      status.value = item.status;
      statusCell.appendChild(status);

      const actions = document.createElement('td');
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'btn small alt';
      edit.textContent = 'Edit';
      edit.addEventListener('click', () => {
        $('tournamentId').value = item.id;
        $('tournamentName').value = item.name;
        $('tournamentMode').value = item.mode;
        if (item.match_at) {
          const localDate = new Date(item.match_at);
          localDate.setMinutes(localDate.getMinutes() - localDate.getTimezoneOffset());
          $('tournamentDate').value = localDate.toISOString().slice(0, 16);
        } else {
          $('tournamentDate').value = '';
        }
        $('tournamentEntryFee').value = item.entry_fee;
        $('tournamentPrizePool').value = item.prize_pool;
        $('tournamentMaxTeams').value = item.max_teams;
        $('tournamentStatus').value = item.status;
        $('tournamentRules').value = item.rules || '';
        $('tournamentSaveButton').textContent = 'Save tournament';
        $('cancelTournamentEdit').classList.remove('hidden');
        document.getElementById('tournamentForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });

      const saveStatus = document.createElement('button');
      saveStatus.type = 'button';
      saveStatus.className = 'btn small';
      saveStatus.textContent = 'Save status';
      saveStatus.addEventListener('click', async () => {
        saveStatus.disabled = true;
        try {
          const { error: updateError } = await supabase.from('tournaments').update({ status: status.value }).eq('id', item.id);
          if (updateError) throw updateError;
          if (msg) msg.textContent = 'Tournament status updated.';
          await Promise.all([renderAdminTournaments(), renderTournaments()]);
        } catch (updateError) {
          console.error('Tournament status update failed:', updateError);
          if (msg) msg.textContent = `Status update failed: ${errorText(updateError)}`;
          saveStatus.disabled = false;
        }
      });

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn small';
      remove.textContent = 'Delete';
      remove.addEventListener('click', async () => {
        if (!window.confirm(`Delete "${item.name}"? Existing registrations will remain but be detached from this tournament.`)) return;
        remove.disabled = true;
        try {
          const { error: deleteError } = await supabase.from('tournaments').delete().eq('id', item.id);
          if (deleteError) throw deleteError;
          if (msg) msg.textContent = 'Tournament deleted.';
          resetTournamentForm();
          await Promise.all([renderAdminTournaments(), renderTournaments()]);
        } catch (deleteError) {
          console.error('Tournament delete failed:', deleteError);
          if (msg) msg.textContent = `Delete failed: ${errorText(deleteError)}`;
          remove.disabled = false;
        }
      });

      actions.append(edit, saveStatus, remove);
      row.append(name, date, count, statusCell, actions);
      tbody.appendChild(row);
    });

    if (msg) msg.textContent = '';
  } catch (error) {
    console.error('Admin tournaments load failed:', error);
    if (msg) msg.textContent = `Tournament list failed: ${errorText(error)}`;
  }
}

function bindTournamentFormEvents() {
  const form = $('tournamentForm');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = $('tournamentId').value;
    const entryFee = Number($('tournamentEntryFee').value);
    const prizePool = Number($('tournamentPrizePool').value);
    const maxTeams = Number($('tournamentMaxTeams').value);
    const name = $('tournamentName').value.trim();
    const mode = $('tournamentMode').value;
    const status = $('tournamentStatus').value;
    const rules = $('tournamentRules').value.trim() || null;
    const dateValue = $('tournamentDate').value;

    if (!name || name.length > 80) {
      $('tournamentAdminMessage').textContent = 'Tournament name is required and must be 1-80 characters.';
      return;
    }

    if (!['Battle Royale', 'Clash Squad'].includes(mode) ||
        !['draft', 'open', 'closed', 'live', 'completed', 'cancelled'].includes(status)) {
      $('tournamentAdminMessage').textContent = 'Select a supported mode and tournament status.';
      return;
    }

    if (dateValue && !Number.isFinite(Date.parse(dateValue))) {
      $('tournamentAdminMessage').textContent = 'Enter a valid tournament date and time.';
      return;
    }

    const matchAt = dateValue ? new Date(dateValue).toISOString() : null;
    if (!Number.isInteger(entryFee) || entryFee < 0 || entryFee > 999999 ||
        !Number.isInteger(prizePool) || prizePool < 0 || prizePool > 999999999 ||
        !Number.isInteger(maxTeams) || maxTeams < 1 || maxTeams > 10000) {
      $('tournamentAdminMessage').textContent = 'Fee, prize, and maximum teams values must be valid.';
      return;
    }

    const payload = { name, mode, match_at: matchAt, entry_fee: entryFee, prize_pool: prizePool, max_teams: maxTeams, status, rules };
    const pendingButton = $('tournamentSaveButton');
    pendingButton.disabled = true;
    try {
      if (id) {
        const { error } = await supabase.from('tournaments').update(payload).eq('id', id);
        if (error) throw error;
        $('tournamentAdminMessage').textContent = 'Tournament updated.';
      } else {
        const { error } = await supabase.from('tournaments').insert(payload);
        if (error) throw error;
        $('tournamentAdminMessage').textContent = 'Tournament created.';
      }
      resetTournamentForm();
      await Promise.all([renderAdminTournaments(), renderTournaments()]);
    } catch (error) {
      console.error('Tournament save failed:', error);
      $('tournamentAdminMessage').textContent = `Tournament save failed: ${errorText(error)}`;
    } finally {
      pendingButton.disabled = false;
    }
  });

  const cancelButton = $('cancelTournamentEdit');
  if (cancelButton) {
    cancelButton.addEventListener('click', resetTournamentForm);
  }
}

function bindDashboardEvents() {
  const refreshButton = $('refreshButton');
  if (refreshButton) {
    refreshButton.addEventListener('click', refreshAdminDashboard);
  }

  const searchInput = $('registrationSearch');
  if (searchInput) {
    searchInput.addEventListener('input', refreshAdminDashboard);
  }

  const statusFilter = $('registrationStatusFilter');
  if (statusFilter) {
    statusFilter.addEventListener('change', refreshAdminDashboard);
  }

  const leaderboardTournament = $('leaderboardTournament');
  if (leaderboardTournament) {
    leaderboardTournament.addEventListener('change', renderLeaderboard);
  }

  const exportButton = $('exportButton');
  if (exportButton) {
    exportButton.addEventListener('click', async () => {
      setBanner('Exporting CSV...');
      try {
        const registrations = await loadRegistrations('all');
        if (!registrations.length) {
          setBanner('No registrations available to export.', 'error');
          return;
        }

        const rows = [
          ['name', 'uid', 'mode', 'contact', 'status', 'points', 'created_at'],
          ...registrations.map((player) => [
            player.name,
            player.uid,
            player.mode,
            player.contact || '',
            player.status,
            player.points,
            player.created_at || '',
          ]),
        ];

        const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'khan-ff-registrations.csv';
        link.click();
        URL.revokeObjectURL(url);
        setBanner('CSV export completed.', 'success');
      } catch (error) {
        console.error('Export failed:', error);
        setBanner(`Export failed: ${errorText(error)}`, 'error');
      }
    });
  }
}

async function refreshAdminDashboard() {
  if (!supabase) {
    setBanner('Supabase is not configured. Add your project URL and publishable key in config/config.js.', 'error');
    return;
  }

  let user;
  try {
    user = await window.KHAN_FF_AUTH?.getAdminUser();
  } catch (error) {
    console.error('Failed to verify the admin session:', error);
    setBanner(`Session check failed: ${errorText(error)}`, 'error');
    return;
  }
  if (!user) {
    setBanner('Sign in with an authorized admin account to view registrations.', 'error');
    return;
  }

  setBanner('Loading registrations...');

  try {
    const [registrations, tournamentData] = await Promise.all([
      loadRegistrations(),
      loadTournaments(),
    ]);

    renderAdminRows(registrations, tournamentData);
    renderAdminTournaments();
    renderTournaments();
    renderLeaderboard();
    setBanner('');
  } catch (error) {
    console.error('Failed to load admin dashboard data:', error);
    setBanner(`Registrations could not be loaded. Check the admin RLS policy and table permissions: ${errorText(error)}`, 'error');
    const tbody = $('adminRows');
    if (tbody) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 7;
      cell.textContent = `Could not load registrations: ${errorText(error)}`;
      row.appendChild(cell);
      tbody.replaceChildren(row);
    }
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  bindDashboardEvents();
  bindTournamentFormEvents();
  if (window.KHAN_FF_AUTH && typeof window.KHAN_FF_AUTH.initializeAdminAuth === 'function') {
    await window.KHAN_FF_AUTH.initializeAdminAuth();
  }
  await renderTournaments();
  await renderLeaderboard();
});

window.refreshAdminDashboard = refreshAdminDashboard;
window.renderTournaments = renderTournaments;
window.renderLeaderboard = renderLeaderboard;
window.KHAN_FF_ADMIN = {
  refreshAdminDashboard,
  renderTournaments,
  renderLeaderboard,
  loadRegistrations,
  loadTournaments,
};
