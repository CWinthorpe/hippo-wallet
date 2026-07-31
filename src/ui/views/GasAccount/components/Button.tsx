import { Button } from 'antd';
import styled from 'styled-components';

export const GasAccountRedBorderedButton = styled(Button)`
  height: 48px;
  font-size: 15px;
  font-style: normal;
  font-weight: 500;
  background-color: transparent;
  color: var(--r-red-default, #e34935);
  border: 1px solid var(--r-red-default, #e34935);

  &:hover {
    background: var(--r-red-light, #fff2f0);
    color: var(--r-red-default, #e34935);
    border: 1px solid var(--r-red-default, #e34935);
  }

  &:focus {
    background-color: transparent;
    color: var(--r-red-default, #e34935);
    border: 1px solid var(--r-red-default, #e34935);
  }

  &:hover:before {
    background-color: transparent;
  }

  &::before {
    transition: none;
    background-color: transparent;
  }
`;

export const GasAccountBlueBorderedButton = styled(Button)`
  height: 48px;
  font-size: 15px;
  font-style: normal;
  font-weight: 500;
  background-color: transparent;
  color: var(--r-blue-default, #0372ff);
  border: 1px solid var(--r-blue-default, #0372ff);

  &:focus {
    background-color: transparent;
    color: var(--r-blue-default, #0372ff);
    border: 1px solid var(--r-blue-default, #0372ff);
  }

  &:hover {
    background: var(--r-blue-light1, #eaf2ff);
    color: var(--r-blue-default, #0372ff);
    border: 1px solid var(--r-blue-default, #0372ff);
  }

  &:hover:before {
    background-color: transparent;
  }

  &::before {
    transition: none;
    background-color: transparent;
  }
  &.ant-btn[disabled],
  &.ant-btn[disabled]:hover,
  &.ant-btn[disabled]:focus,
  &.ant-btn[disabled]:active {
    background-color: transparent;
    color: var(--r-blue-default, #0372ff);
    border: 1px solid var(--r-blue-default, #0372ff);
  }
`;
