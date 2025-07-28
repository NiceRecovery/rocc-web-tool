import { RoccController } from './rocc.js';

const rocc = new RoccController(9600);

document.getElementById('connectButton').addEventListener('click', async () => {
  await rocc.connect();
  log('Connected');
  const success = await rocc.authenticate();
  log('Authentication ' + (success ? 'succeeded' : 'failed'));
});

document.getElementById('readFileButton').addEventListener('click', async () => {
  //const filename = prompt('Enter filename to read:');
  const success = await rocc.readTextFile('roccdat.csv');
  log(success ? 'File downloaded' : 'Failed to read file');
});

document.getElementById('clearFileButton').addEventListener('click', async () => {
  const success = await rocc.clearFile('roccdat.csv');
  log(success ? 'File cleared' : 'Failed to clear file');
});

document.getElementById('setTimeButton').addEventListener('click', async () => {
  const success = await rocc.setTime();
  log('Time ' + (success ? 'set successfully' : 'failed to set'));
});

document.getElementById('getTimeButton').addEventListener('click', async () => {
  const time = await rocc.getTime();
  log('Current time: ' + time);
});

function log(message) {
  const output = document.getElementById('output');
  output.value += message + '\n';
  output.scrollTop = output.scrollHeight;
}
