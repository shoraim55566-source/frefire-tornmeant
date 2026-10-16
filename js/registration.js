import { supabase } from './supabase-client.js';

const $ = (id) => document.getElementById(id);

function setMessage(message, type = 'status') {
  const el = $('registrationMessage');
  if (!el) return;
  el.textContent = message;
  el.dataset.type = type;
}

function isValidUid(uid) {
  return /^[0-9]{5,20}$/.test(uid);
}

async function submitRegistration(event) {
  event.preventDefault();
  if (!supabase) {
    setMessage('Supabase is not configured. Add your project URL and publishable key in config/config.js.', 'error');
    return;
  }

  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const name = $('playerName').value.trim();
  const uid = $('playerUID').value.trim();
  const mode = $('gameMode').value;
  const contact = $('playerContact').value.trim();
  const tournamentId = $('registrationTournament').value || null;

  if (!name || name.length > 40) {
    setMessage('Player name is required and must be 1-40 characters.', 'error');
    return;
  }

  if (!isValidUid(uid)) {
    setMessage('A valid 5-20 digit Free Fire UID is required.', 'error');
    return;
  }

  if (!['Battle Royale', 'Clash Squad'].includes(mode)) {
    setMessage('Select a supported game mode.', 'error');
    return;
  }

  button.disabled = true;
  setMessage('Submitting registration…');

  try {
    const { error } = await supabase.from('registrations').insert({
      name,
      uid,
      mode,
      contact: contact || null,
      tournament_id: tournamentId,
    });

    if (error) {
      if (error.code === '23505' || error.code === 'P0001') {
        throw new Error(error.message || 'This UID is already registered or the tournament is full.');
      }
      throw error;
    }

    setMessage('Registration submitted successfully. Please wait for admin approval.', 'success');
    form.reset();
    $('registrationTournament').value = '';
    $('gameMode').disabled = false;
  } catch (error) {
    console.error('Registration submission failed:', error);
    setMessage(`Registration failed: ${error.message || 'Please try again.'}`, 'error');
  } finally {
    button.disabled = false;
  }
}

function bindRegistrationEvents() {
  const form = $('registrationForm');
  if (!form) return;

  form.addEventListener('submit', submitRegistration);

  const tournamentSelect = $('registrationTournament');
  const gameMode = $('gameMode');
  if (tournamentSelect && gameMode) {
    tournamentSelect.addEventListener('change', () => {
      const tournament = JSON.parse(document.body.dataset.tournaments || '[]').find((item) => item.id === tournamentSelect.value);
      gameMode.disabled = Boolean(tournament);
      if (tournament) {
        gameMode.value = tournament.mode;
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', bindRegistrationEvents);
