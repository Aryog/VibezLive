interface CardProps {
  children: React.ReactNode;
  className?: string;
}

export const Card: React.FC<CardProps> = ({ children, className = "" }) => {
  return (
    <div className={`relative overflow-hidden rounded-lg shadow-md ${className}`}>
      {children}
    </div>
  );
}; 