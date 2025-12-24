export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

export const formatNumber = (num: number): string => {
  return new Intl.NumberFormat('en-IN').format(num);
};

export const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

export const formatTime = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const getCategoryIcon = (category: string): string => {
  const icons: Record<string, string> = {
    food: 'restaurant',
    transport: 'car',
    shopping: 'cart',
    utilities: 'flash',
    entertainment: 'film',
    health: 'medkit',
    education: 'school',
    salary: 'cash',
    investment: 'trending-up',
    transfer: 'swap-horizontal',
    emi: 'card',
    subscription: 'repeat',
    other: 'ellipsis-horizontal',
  };
  return icons[category] || 'ellipsis-horizontal';
};

export const getCategoryColor = (category: string): string => {
  const colors: Record<string, string> = {
    food: '#FF6B6B',
    transport: '#4ECDC4',
    shopping: '#45B7D1',
    utilities: '#96CEB4',
    entertainment: '#FFEAA7',
    health: '#DDA0DD',
    education: '#98D8C8',
    salary: '#7BED9F',
    investment: '#70A1FF',
    transfer: '#A29BFE',
    emi: '#FD79A8',
    subscription: '#FDCB6E',
    other: '#B2BEC3',
  };
  return colors[category] || '#B2BEC3';
};
