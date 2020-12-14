/* eslint-disable no-unused-vars */
const o = require('ospec');

const {
  reactions,
  createBox,
  createNamedBoxes,
  createReaction,
  s,
  sFrom,
  sIgnore,
} = require('../src/sGlobal.js');

o.spec('haptic-reactivity', function() {
  o('box creation', function() {
    let data;

    data = createBox('');
    o(/^B\d+$/.test(data.id)).equals(true);

    data = createBox('', 'withName');
    o(/^B\d+:withName$/.test(data.id)).equals(true);

    data = createNamedBoxes({
      label: '💕',
    });
    o(data.id).equals(undefined);
    o(/^B\d+:label$/.test(data.label.id)).equals(true);
  });

  o('box creation by reference', function() {
    let data;
    let ref = {
      label: '💕',
      count: 0,
      wsMessages: [],
    };
    data = createNamedBoxes(ref);
    o(data).equals(ref)`Box reference doesn't change`;
  });

  o('box read/write', function() {
    let data = createNamedBoxes({ label: '💕' });
    o(data.label()).equals('💕')`Read works`;
    o(data.label('...')).equals(void 0)`Writing a value returns nothing/void`;
    o(data.label()).equals('...')`Writing then reading works`;
  });

  o('reaction creation', function() {
    let data = createNamedBoxes({ count: 0 });
    let R = createReaction(() => {
      // Required else the reaction automatically removes itself
      s(data.count);
    });
    o(reactions.has(R)).equals(true);
    o(R.id).equals('R0:<Anon>')`Reaction naming for anonymous function works`;
  });

  o('reaction creation by reference', function() {
    let data = createNamedBoxes({ count: 0 });
    function refFunction() {
      s(data.count);
    }
    let R = createReaction(refFunction);
    o(R).equals(refFunction)`Reaction reference doesn't change`;
    o(R.id).equals('R1:refFunction')`Reaction naming for named functions works`;
  });

  o('reaction automatically removed', function() {
    let R = createReaction(() => {});
    o(reactions.has(R)).equals(false);
  });

  o.spec('reaction reads', function() {
    let data = createNamedBoxes({
      label: '!!!',
      count: 0,
    });

    o('sub read pass read', function() {
      let R = createReaction(() => {
        s(data.count);
        data.label();
      });
      o(R.runs).equals(1)`Reaction runs on initialization`;

      // Test sub reads
      o(R.reactionSubbedReads.size).equals(1);
      o(R.reactionSubbedReads.has(data.count)).equals(true);
      o(data.count.reactions.has(R)).equals(true);

      // Test pass reads
      o(R.reactionPassedReads.size).equals(1);
      o(R.reactionPassedReads.has(data.label)).equals(true);
      o(data.label.reactions.has(R)).equals(false);
    });

    function checkRollback(R) {
      // These are removed during the rollback
      // o(R.reactionSubbedReads.has(data.count)).equals(false)`Reaction rollback doesn't hold sub-reads`;
      // o(R.reactionPassedReads.has(data.count)).equals(false)`Reaction rollback doesn't hold pass-reads`;
      o(data.count.reactions.has(R)).equals(false)`Previously subbed boxes don't hold rollbacked reactions`;
    }
    o('read after subscribe throws', function() {
      // Can't use `R = createReaction(() => {...})` since it throws so doesn't
      // return a value to assign to R
      let R = () => {
        s(data.count) + data.count();
      };
      try {
        createReaction(R);
      } catch (err) {
        o(err.message).equals(`Reaction ${R.id} can't pass-read ${data.count.id} after subscribe-reading it; pick one`);
      }
      checkRollback(R);
    });

    o('subscribe after read throws', function() {
      // Can't use `R = createReaction(() => {...})` since it throws so doesn't
      // return a value to assign to R
      let R = () => {
        data.count() + s(data.count);
      };
      try {
        createReaction(R);
      } catch (err) {
        o(err.message).equals(`Reaction ${R.id} can't subscribe-read to ${data.count.id} after pass-reading it; pick one`);
      }
      checkRollback(R);
    });
  });

  o.spec('reaction call order', function() {
    let data = createNamedBoxes({
      wsMessages: [],
      label: '!!!',
    });
    let R1, R2;
    let str = '';
    // Some user-land utility function...
    function addLog(msg) {
      data.wsMessages(data.wsMessages().concat(msg));
    }

    o.beforeEach(function() {
      if (R1) R1.runs = 0;
      if (R2) R2.runs = 0;
    });

    o('create R1 with wsMessage sub', function() {
      R1 = createReaction(function writeLog() {
        str = `${s(data.wsMessages).length} items${
          s(data.wsMessages).length > 0
            ? '\n- ' + s(data.wsMessages).join('\n- ')
            : ''}`;
      });

      o(R1.runs).equals(1);
      o(str).equals('0 items');
      o(data.wsMessages.reactions.size).equals(1);

      addLog('🐈🐈🐈');
      o(R1.runs).equals(2);
      o(str).equals('1 items\n- 🐈🐈🐈');
      o(data.wsMessages.reactions.size).equals(1);
    });

    o('create R2 reading wsMessage from addLog()', function() {
      R2 = createReaction(() => {
        addLog('...');
        s(data.label);
      });

      o(R1.runs).equals(1);
      o(R2.runs).equals(1);

      // This is literally the whole reason I started this. In Sinuous it would
      // secretly subscribe and ruin your day...
      o(R2.reactionSubbedReads.has(data.wsMessages)).equals(false);
      o(str).equals('2 items\n- 🐈🐈🐈\n- ...');
    });

    o('addLog() calls R1 not R2', function() {
      addLog('R1 not R2');
      o(R1.runs).equals(1);
      o(R2.runs).equals(0);
    });

    o('data.label() calls R1 and R2', function() {
      data.label('R1 and R2');
      o(R1.runs).equals(1);
      o(R2.runs).equals(1);
    });
  });


  o.spec('s()', function() {
    let data = createNamedBoxes({
      label: '???',
      count: 0,
    });

    function partialReaction() {
      const value = s(data.count);
      return value * 100;
    }

    o('needs an active reaction', function() {
      try {
        partialReaction();
        throw 'Should have thrown...';
      } catch (err) {
        o(err.message).equals('s() Can\'t subscribe; no active reaction');
      }
    });
    // ✨ This is it ✨
    o('not allowed to hide s() in a function', function() {
      // Visually looks like it doesn't do any subscriptions - so it shouldn't
      try {
        createReaction(() => {
          console.log(data.label() + partialReaction());
        });
        throw 'Should have thrown...';
      } catch (err) {
        o(err.message).equals(`s() Can't subscribe; caller "${partialReaction.name}" isn't the active/allowed reaction`);
      }
    });
  });

  o.spec('sFrom()', function() {
    let data = createNamedBoxes({
      label: '???',
      count: 0,
    });

    function partialReaction() {
      const value = s(data.count);
      return value * 100;
    }

    o('needs an active reaction', function() {
      try {
        sFrom(partialReaction);
        throw 'Should have thrown...';
      } catch (err) {
        o(err.message).equals('sFrom() Can\'t subscribe; no active reaction');
      }
    });
    o('passes subscriptions', function() {
      // Visually looks like it does subscriptions
      let R = createReaction(() => {
        s(data.label);
        sFrom(partialReaction);
      });
      o(R.reactionSubbedReads.has(data.label)).equals(true);
      o(R.reactionSubbedReads.has(data.count)).equals(true);
    });
    o('enforces read consistency in sFrom', function() {
      let R;
      try {
        R = createReaction(() => {
          sFrom(() => s(data.count) + data.count());
        });
        throw 'Should have thrown...';
      } catch (err) {
        o(err.message).equals(`Reaction CAPTURE can't pass-read ${data.count.id} after subscribe-reading it; pick one`);
      }
    });
    o('read consistency between sFrom and top-level is ignored', function() {
      let R;
      try {
        R = createReaction(() => {
          data.count();
          sFrom(() => s(data.count));
        });
      } catch (err) {
        throw 'Shouldn\'t have thrown';
      }
    });
  });

  o.spec('sIgnore()', function() {
    let data = createNamedBoxes({
      label: '???',
      count: 0,
    });

    function partialReaction() {
      const value = s(data.count);
      return value * 100;
    }

    o('doesn\'t need an active reaction', function() {
      try {
        sIgnore(partialReaction);
      } catch (err) {
        throw 'Shouldn\'t have thrown';
      }
    });
    o('doesn\'t pass subscriptions', function() {
      // Visually looks like it does subscriptions
      let R = createReaction(() => {
        s(data.label);
        sIgnore(partialReaction);
      });
      o(R.reactionSubbedReads.has(data.label)).equals(true);
      o(R.reactionSubbedReads.has(data.count)).equals(false);
    });
    o('enforces read consistency in sIgnore', function() {
      let R;
      try {
        R = createReaction(() => {
          sIgnore(() => s(data.count) + data.count());
        });
        throw 'Should have thrown...';
      } catch (err) {
        o(err.message).equals(`Reaction CAPTURE can't pass-read ${data.count.id} after subscribe-reading it; pick one`);
      }
    });
    o('read consistency between sIgnore and top-level is ignored', function() {
      let R;
      try {
        R = createReaction(() => {
          data.count();
          sIgnore(() => s(data.count));
        });
      } catch (err) {
        throw 'Shouldn\'t have thrown';
      }
    });
  });
});
