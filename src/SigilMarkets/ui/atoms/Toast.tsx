interface ToastProps {
  message: string;
}

export const Toast = ({ message }: ToastProps) => {
  return <div className="sm-toast">{message}</div>;
};
