import { NavLink } from 'react-router-dom';

const navItems = [
  { label: 'Markets', to: '/' },
  { label: 'Vault', to: '/vault' },
  { label: 'Positions', to: '/positions' },
  { label: 'Prophecy', to: '/prophecy' },
  { label: 'Resolution', to: '/resolution' }
];

export const BottomNav = () => {
  return (
    <nav className="sm-bottom-nav">
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `sm-bottom-nav__item${isActive ? ' active' : ''}`
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
};
