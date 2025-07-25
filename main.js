import { RoccController } from './rocc.js';

const rocc = new RoccController(9600);

document.getElementById('connectButton').addEventListener('click', async () => {
  await rocc.connect();
  log('Connected');
  const success = await rocc.authenticate();
  log('Authentication ' + (success ? 'succeeded' : 'failed'));
//   log('Setting time...');
//   const timeSet = await rocc.setTime();
//   log('Time ' + (timeSet ? 'set successfully' : 'failed to set'));
//   log('Downloading file...');
//   const success1 = await rocc.readTextFile('roccdat.csv');
//   log(success1 ? 'File downloaded' : 'Failed to read file');
});

// document.getElementById('disconnectButton').addEventListener('click', async () => {
//   await rocc.disconnect();
//   log('Disconnected');
// });

document.getElementById('readFileButton').addEventListener('click', async () => {
  //const filename = prompt('Enter filename to read:');
  const success = await rocc.readTextFile('roccdat.csv');
  log(success ? 'File downloaded' : 'Failed to read file');
});

document.getElementById('setTimeButton').addEventListener('click', async () => {
  const success = await rocc.setTime();
  log('Time ' + (success ? 'set successfully' : 'failed to set'));
});

document.getElementById('sendButton').addEventListener('click', async () => {
  const cmd = document.getElementById('inputText').value;
  const response = await rocc.sendCommand(cmd);
  log('> ' + cmd);
  log('< ' + response);
});

function log(message) {
  const output = document.getElementById('output');
  output.value += message + '\n';
  output.scrollTop = output.scrollHeight;
}
