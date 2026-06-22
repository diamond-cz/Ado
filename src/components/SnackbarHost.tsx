import { Alert, Snackbar } from "@mui/material";
import { useStore } from "../state/store";

export function SnackbarHost() {
  const snacks = useStore((s) => s.snacks);
  const dismiss = useStore((s) => s.dismissSnack);

  return (
    <>
      {snacks.map((s, i) => (
        <Snackbar
          key={s.id}
          open
          autoHideDuration={3000}
          onClose={() => dismiss(s.id)}
          anchorOrigin={{ vertical: "top", horizontal: "right" }}
          sx={{ top: 40 + i * 56 }}
        >
          <Alert
            severity={s.severity}
            variant="filled"
            onClose={() => dismiss(s.id)}
            sx={{ minWidth: 240, maxWidth: 480 }}
          >
            {s.message}
          </Alert>
        </Snackbar>
      ))}
    </>
  );
}
