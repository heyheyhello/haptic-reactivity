// const o = require('ospec');
// require('./test/sGlobalTests.js');
// o.run();

const { boxes, rx, live } = require('./src/sLocal.js');
const data = boxes({ label: 'Ok', count: 0 });
const r0 = rx(() => {
  console.log('Hey!', data.count());
});
console.log('r0', r0.sr);
console.log('live', live);

r0();

console.log('r0.unsubscribe');
r0.unsubscribe();

console.log('live', live);

data.count(10);

const r1 = rx(s => {
  console.log('Hey!', s(data.count));
});
console.log('r1', r1.sr);

console.log('live', live);

data.count(100);

// Pause
r1.unsubscribe();

console.log('data.count next');
data.count(101);
console.log('data.count next');
data.count(110);

// Start
r1();

console.log('data.count next');
data.count(111);
