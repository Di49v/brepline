import { createContext, useCallback, useContext, useState } from "react";
import Icon from "./Icon.jsx";

const Ctx = createContext(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg) => {
    const id = Math.random();
    setItems((x) => [...x, { id, msg }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 2200);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((i) => (
          <div className="toast" key={i.id}>
            <Icon name="check" size={13} /> {i.msg}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
