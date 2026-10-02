// Test-only bundle loaded with the same plain-script context as bootstrap.js.
export { transcribeAudio } from "../src/modules/preferences/SpeechTranscriptionService";
export {
  attachVoiceInput,
  appendVoiceTranscript,
} from "../src/modules/ui/chat-panel/VoiceInputController";
export {
  startWindowsAudioCapture,
  probeWindowsAudioCapture,
} from "../src/modules/ui/chat-panel/WindowsAudioCapture";
