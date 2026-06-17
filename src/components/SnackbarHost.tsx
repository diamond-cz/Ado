import { Alert, Snackbar } from "@mui/material";
import { useStore } from "../state/store";

export function SnackbarHost() {
  const snacks = useStore((s) => s.snacks);
  const dismiss = useStore((s) => s.dismissSnack);

  return (
    <>
      {snacks.map((snack, index) => (
        <Snackbar
          key={snack.id}
          open
          autoHideDuration={3000}
          onClose={() => dismiss(snack.id)}
          anchorOrigin={{ vertical: "top", horizontal: "right" }}
          sx={{ top: 40 + index * 56 }}
        >
          <Alert
            severity={snack.severity}
            variant="filled"
            onClose={() => dismiss(snack.id)}
            sx={{ minWidth: 240, maxWidth: 480 }}
          >
            {snack.message}
          </Alert>
        </Snackbar>
      ))}
    </>
  );
}
