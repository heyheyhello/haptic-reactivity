There are two files here. Each addresses explicit subscriptions which is the
goal compared to libraries like Sinuous/S.js, but they do it each very
differently.

First was sGlobal, which has the subscription function, s(), as a global. This
was intuitive at the time, but wow, it's a lot of code to handle cases where s()
is used outside of the right context. That's where sFrom() and sIgnore() come
from. There's custom errors that _have_ to be thrown to address using s()
incorrectly such as outside of a reaction.

This couldn't be used in strict mode or ES modules since it uses Function.caller
to know the context...

Then I noticed wow no thanks how about s() as a parameter to the function:

```js
createReaction(s => {
  // Here you pass-read count but sub-read value
  data.count() + s(data.value)
})
```

Do you know what that means for nested functions? You pass in the s parameter!
It's explicit but there's no global variable mess. If you want to write a
partial reaction, like everyone in Haptic will, you accept an s parameter...
There's no difference between top-level calls and sub-calls, so there's no need
to use Function.caller either.
