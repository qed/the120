Accordion FAQ row with a +/− toggle. Keep one item open at a time in the parent's state.

```jsx
const [open, setOpen] = React.useState(0);
<FaqItem question="What is the Tin Can?" open={open === 0} onToggle={() => setOpen(0)}>
  A screen-free phone with the 120 Address Book.
</FaqItem>
```
