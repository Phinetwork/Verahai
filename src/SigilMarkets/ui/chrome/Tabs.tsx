interface TabsProps {
  tabs: string[];
  active: string;
  onChange: (tab: string) => void;
}

export const Tabs = ({ tabs, active, onChange }: TabsProps) => {
  return (
    <div className="sm-tabs">
      {tabs.map((tab) => (
        <button
          key={tab}
          className={tab === active ? 'is-active' : ''}
          onClick={() => onChange(tab)}
        >
          {tab}
        </button>
      ))}
    </div>
  );
};
