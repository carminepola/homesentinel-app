const ALARM_STATES = [
  { value: "disarmed", label: "Disarmato" },
  { value: "armed_home", label: "In casa" },
  { value: "armed_away", label: "Fuori casa" },
  { value: "armed_night", label: "Notte" },
  { value: "triggered", label: "In allarme" },
];

const ALARM_STATE_LABELS = ALARM_STATES.reduce((acc, s) => {
  acc[s.value] = s.label;
  return acc;
}, {});

function getAlarmStateLabel(state) {
  if (!state) return "Sconosciuto";
  return ALARM_STATE_LABELS[state.toLowerCase()] || state;
}

function isCameraVisibleInState(mapping, alarmState) {
  if (!alarmState) return true;
  const visibleStates = mapping?.visibleStates;
  if (!Array.isArray(visibleStates) || visibleStates.length === 0) {
    return true;
  }
  return visibleStates.includes(alarmState.toLowerCase());
}

module.exports = { ALARM_STATES, ALARM_STATE_LABELS, getAlarmStateLabel, isCameraVisibleInState };
