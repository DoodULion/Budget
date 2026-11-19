import { formatCents, monthLabel, monthOf } from './calc';
import PurchaseForm from './PurchaseForm';
import type { Store } from './store';
import { useUndo } from './undo';

/** Log a purchase in a few taps. After saving, the form clears for the next one and Undo is offered. */
export default function Add({ store, today }: { store: Store; today: string }) {
  const { offer } = useUndo();
  return (
    <div className="screen">
      <h1 className="page-title">Add a purchase</h1>
      <PurchaseForm
        store={store}
        today={today}
        submitLabel="Save purchase"
        onSubmit={async (p) => {
          await store.putPurchase(p);
          const cat = store.data.categories.find((c) => c.id === p.categoryId)?.name ?? 'Purchase';
          offer(`Saved ${cat} ${formatCents(p.amountCents)} in ${monthLabel(monthOf(p.date))}`, () => store.removePurchase(p.id));
        }}
      />
    </div>
  );
}
