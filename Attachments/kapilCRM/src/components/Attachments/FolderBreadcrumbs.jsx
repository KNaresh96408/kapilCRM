import React from 'react';
import PropTypes from 'prop-types';

const FolderBreadcrumbs = ({ path, onNavigate }) => {
  return (
    <nav>
      <ul className="breadcrumb">
        {path.map((folder, index) => (
          <li key={index}>
            <button onClick={() => onNavigate(folder)}>
              {folder}
            </button>
            {index < path.length - 1 && <span> / </span>}
          </li>
        ))}
      </ul>
    </nav>
  );
};

FolderBreadcrumbs.propTypes = {
  path: PropTypes.arrayOf(PropTypes.string).isRequired,
  onNavigate: PropTypes.func.isRequired,
};

export default FolderBreadcrumbs;